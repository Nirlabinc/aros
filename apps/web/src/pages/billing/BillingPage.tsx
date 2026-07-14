import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

interface BillingSubscription {
  id: string;
  status: string;
  plan: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

interface BillingInvoice {
  id?: string;
  number?: string;
  status?: string;
  totalCents?: number;
  amountCents?: number;
  usageCents?: number;
  periodStart?: string;
  periodEnd?: string;
  createdAt?: string;
  paidAt?: string;
  dueAt?: string;
  lineItemCount?: number;
}

interface BillingBreakdownItem {
  label?: string;
  name?: string;
  model?: string;
  app?: string;
  task?: string;
  type?: string;
  count?: number;
  totalCents?: number;
  amountCents?: number;
  usageCents?: number;
}

interface BillingUsageSummary {
  totalCents?: number;
  eventCount?: number;
  periodStart?: string;
  periodEnd?: string;
  byModel?: BillingBreakdownItem[];
  byApp?: BillingBreakdownItem[];
  byTask?: BillingBreakdownItem[];
  billableBreakdown?: BillingBreakdownItem[];
}

interface BillingStatus {
  tenantId: string;
  plan: string;
  billingStatus: string;
  stripeCustomerId: string | null;
  subscription: BillingSubscription | null;
  licenseTier: string;
  balanceCents?: number;
  lifetimeSpendCents?: number;
  currentPeriodSpendCents?: number;
  currentPeriodEventCount?: number;
  totalSpendCents?: number;
  invoiceCount?: number;
  invoices?: BillingInvoice[];
  recentInvoices?: BillingInvoice[];
  invoiceHistory?: BillingInvoice[];
  billableBreakdown?: BillingBreakdownItem[];
  currentPeriodUsage?: BillingUsageSummary;
  usage?: BillingUsageSummary;
  error?: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter ($49/mo)',
  pro: 'Pro ($149/mo)',
  enterprise: 'Business ($499/mo)',
};

function formatMoney(cents?: number | null): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCount(count?: number | null): string {
  if (count == null || Number.isNaN(count)) return '—';
  return count.toLocaleString();
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getStatusLabel(status?: string): { label: string; color: string; background: string } {
  switch (status) {
    case 'active':
    case 'trialing':
      return { label: 'Active', color: '#16a34a', background: '#f0fdf4' };
    case 'past_due':
    case 'payment_failed':
      return { label: 'Payment issue', color: '#dc2626', background: '#fef2f2' };
    case 'cancelled':
      return { label: 'Cancelled', color: '#b45309', background: '#fffbeb' };
    default:
      return { label: 'Free Tier', color: '#6b7280', background: '#f3f4f6' };
  }
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(Boolean) as T[] : [];
}

function extractArrayFromValue<T>(value: unknown, keys: string[] = []): T[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean) as T[];
  }
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(Boolean) as T[];
    }
  }
  return [];
}

type MoneyLike = {
  totalCents?: number;
  amountCents?: number;
  usageCents?: number;
};

function pickCents(item?: MoneyLike | null): number | undefined {
  if (!item) return undefined;
  return item.totalCents ?? item.amountCents ?? item.usageCents;
}

function breakdownLabel(item: BillingBreakdownItem): string {
  return item.label
    || item.name
    || item.model
    || item.app
    || item.task
    || item.type
    || 'Unknown';
}

function breakdownContext(item: BillingBreakdownItem): string {
  return item.model || item.app || item.task || item.type || '';
}

function mergeBreakdownItems(...groups: Array<BillingBreakdownItem[] | undefined>): BillingBreakdownItem[] {
  const seen = new Set<string>();
  const merged: BillingBreakdownItem[] = [];

  for (const group of groups) {
    for (const item of group ?? []) {
      const key = [
        breakdownLabel(item),
        breakdownContext(item),
        pickCents(item) ?? '',
        item.count ?? '',
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

function usageTotalCents(summary?: BillingUsageSummary | null): number | undefined {
  if (!summary) return undefined;
  if (summary.totalCents != null) return summary.totalCents;
  const items = [
    ...normalizeArray<BillingBreakdownItem>(summary.byModel),
    ...normalizeArray<BillingBreakdownItem>(summary.byApp),
    ...normalizeArray<BillingBreakdownItem>(summary.byTask),
    ...normalizeArray<BillingBreakdownItem>(summary.billableBreakdown),
  ];
  if (items.length === 0) return undefined;
  return items.reduce((sum, item) => sum + (pickCents(item) ?? 0), 0);
}

function usageEventCount(summary?: BillingUsageSummary | null): number | undefined {
  if (!summary) return undefined;
  if (summary.eventCount != null) return summary.eventCount;
  const items = [
    ...normalizeArray<BillingBreakdownItem>(summary.byModel),
    ...normalizeArray<BillingBreakdownItem>(summary.byApp),
    ...normalizeArray<BillingBreakdownItem>(summary.byTask),
    ...normalizeArray<BillingBreakdownItem>(summary.billableBreakdown),
  ];
  if (items.length === 0) return undefined;
  const count = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
  return count > 0 ? count : undefined;
}

function pickBillingInvoices(source: BillingStatus | null, apiInvoices: unknown): BillingInvoice[] {
  const direct = extractArrayFromValue<BillingInvoice>(source?.invoices);
  if (direct.length > 0) return direct;
  const recent = extractArrayFromValue<BillingInvoice>(source?.recentInvoices);
  if (recent.length > 0) return recent;
  const history = extractArrayFromValue<BillingInvoice>(source?.invoiceHistory);
  if (history.length > 0) return history;
  return extractArrayFromValue<BillingInvoice>(apiInvoices, ['invoices', 'recentInvoices', 'invoiceHistory', 'data', 'items']);
}

function pickBreakdown(source: BillingStatus | null, apiUsage: unknown): BillingUsageSummary | null {
  const currentUsage = source?.currentPeriodUsage ?? source?.usage ?? null;
  const usageFromApi = apiUsage && typeof apiUsage === 'object' ? apiUsage as BillingUsageSummary : null;

  const byModel = mergeBreakdownItems(currentUsage?.byModel, usageFromApi?.byModel);
  const byApp = mergeBreakdownItems(currentUsage?.byApp, usageFromApi?.byApp);
  const byTask = mergeBreakdownItems(currentUsage?.byTask, usageFromApi?.byTask);
  const genericBreakdown = mergeBreakdownItems(
    currentUsage?.billableBreakdown,
    source?.billableBreakdown,
    usageFromApi?.billableBreakdown,
  );

  const totalCents = currentUsage?.totalCents ?? usageFromApi?.totalCents;
  const eventCount = currentUsage?.eventCount ?? usageFromApi?.eventCount ?? source?.currentPeriodEventCount;
  const periodStart = currentUsage?.periodStart ?? usageFromApi?.periodStart;
  const periodEnd = currentUsage?.periodEnd ?? usageFromApi?.periodEnd;

  if (
    totalCents == null
    && eventCount == null
    && byModel.length === 0
    && byApp.length === 0
    && byTask.length === 0
    && genericBreakdown.length === 0
  ) {
    return null;
  }

  return {
    totalCents,
    eventCount,
    periodStart,
    periodEnd,
    byModel,
    byApp,
    byTask,
    billableBreakdown: genericBreakdown,
  };
}

function BreakdownSection({
  title,
  items,
  accent,
}: {
  title: string;
  items: BillingBreakdownItem[];
  accent: string;
}) {
  if (items.length === 0) return null;

  const maxCents = Math.max(...items.map(item => pickCents(item) ?? 0), 1);

  return (
    <div style={styles.breakdownCard}>
      <div style={styles.cardHeaderRow}>
        <h3 style={styles.cardTitle}>{title}</h3>
        <span style={styles.cardPill}>{items.length} items</span>
      </div>
      <div style={styles.breakdownList}>
        {items.slice(0, 5).map((item, index) => {
          const cents = pickCents(item) ?? 0;
          const width = `${Math.max((cents / maxCents) * 100, cents > 0 ? 4 : 0)}%`;
          return (
            <div key={`${title}-${index}`} style={styles.breakdownRow}>
              <div style={styles.breakdownRowHeader}>
                <span style={styles.breakdownLabel}>{breakdownLabel(item)}</span>
                <span style={{ ...styles.breakdownValue, color: accent }}>{formatMoney(cents)}</span>
              </div>
              <div style={styles.barTrack}>
                <div
                  style={{
                    ...styles.barFill,
                    background: accent,
                    width,
                  }}
                />
              </div>
              <div style={styles.breakdownMeta}>
                <span>{formatCount(item.count)} events</span>
                {breakdownContext(item) && <span>{breakdownContext(item)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BillingPage() {
  const { tenant, user, loading: authLoading } = useAuth();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [usage, setUsage] = useState<BillingUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState('');

  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('status');

  useEffect(() => {
    if (authLoading) return;
    if (!tenant?.id) {
      setLoading(false);
      setError('No workspace found.');
      return;
    }

    const tenantId = tenant.id;
    let cancelled = false;

    async function loadBilling() {
      setLoading(true);
      setError('');

      try {
        const [statusRes, invoicesRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/billing/status?tenantId=${tenantId}`),
          fetch(`${API_BASE}/api/companies/${tenantId}/invoices`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        let statusData: BillingStatus | null = null;
        let invoicePayload: unknown = null;
        let loadError = '';

        if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
          const statusJson = await statusRes.value.json();
          statusData = statusJson as BillingStatus;
          if (statusData.error) {
            loadError = statusData.error;
          }
        } else if (statusRes.status === 'fulfilled') {
          const body = await statusRes.value.json().catch(() => ({}));
          loadError = body?.error || 'Failed to load billing info';
        } else {
          loadError = 'Failed to load billing info';
        }

        if (invoicesRes.status === 'fulfilled' && invoicesRes.value.ok) {
          invoicePayload = await invoicesRes.value.json();
        }

        const mergedInvoices = pickBillingInvoices(statusData, invoicePayload);
        const mergedUsage = pickBreakdown(statusData, null);

        setBilling(statusData);
        setInvoices(mergedInvoices);
        setUsage(mergedUsage);

        if (loadError) {
          setError(loadError);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load billing info');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBilling();

    return () => {
      cancelled = true;
    };
  }, [authLoading, tenant?.id]);

  async function openPortal() {
    if (!billing?.stripeCustomerId) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeCustomerId: billing.stripeCustomerId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleUpgrade(plan: string) {
    if (!tenant) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          plan,
          email: user?.email,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError('Failed to start checkout');
    } finally {
      setPortalLoading(false);
    }
  }

  const statusInfo = getStatusLabel(billing?.billingStatus);
  const totalSpendCents = billing?.lifetimeSpendCents
    ?? billing?.totalSpendCents
    ?? undefined;
  const currentPeriodCents = billing?.currentPeriodSpendCents
    ?? usageTotalCents(usage)
    ?? undefined;
  const invoiceCount = billing?.invoiceCount ?? invoices.length;
  const eventCount = usageEventCount(usage) ?? billing?.currentPeriodEventCount;
  const modelBreakdown = usage?.byModel ?? [];
  const appBreakdown = usage?.byApp ?? [];
  const taskBreakdown = usage?.byTask ?? [];
  const genericBreakdown = usage?.billableBreakdown ?? [];
  const hasBreakdown = modelBreakdown.length > 0 || appBreakdown.length > 0 || taskBreakdown.length > 0 || genericBreakdown.length > 0;

  if (loading) {
    return (
      <div style={styles.wrapper}>
        <p style={{ color: '#6b7280' }}>Loading billing info...</p>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Billing</h1>
          <p style={styles.subtitle}>Review usage, invoices, and plan details in one place.</p>
        </div>
      </div>

      {paymentStatus === 'success' && (
        <div style={styles.successBanner}>
          Payment successful. Your plan has been updated.
        </div>
      )}
      {paymentStatus === 'cancelled' && (
        <div style={styles.warningBanner}>
          Payment was cancelled. Your plan has not changed.
        </div>
      )}
      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardHeaderRow}>
            <h2 style={styles.cardTitle}>Current Plan</h2>
            <span
              style={{
                ...styles.cardPill,
                background: statusInfo.background,
                color: statusInfo.color,
              }}
            >
              {statusInfo.label}
            </span>
          </div>

          <div style={styles.planDisplay}>
            <span style={styles.planName}>
              {PLAN_LABELS[billing?.plan || 'free'] || billing?.plan || 'Free'}
            </span>
            <span style={styles.planMeta}>
              {billing?.licenseTier ? `License tier: ${billing.licenseTier}` : 'Customer billing surface'}
            </span>
          </div>

          <div style={styles.summaryGrid}>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Total spend</span>
              <span style={styles.summaryValue}>{formatMoney(totalSpendCents)}</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Current period</span>
              <span style={styles.summaryValue}>{formatMoney(currentPeriodCents)}</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Invoices</span>
              <span style={styles.summaryValue}>{formatCount(invoiceCount)}</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Usage events</span>
              <span style={styles.summaryValue}>{formatCount(eventCount)}</span>
            </div>
          </div>

          <div style={styles.subDetails}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Current period ends</span>
              <span>{formatDate(billing?.subscription?.currentPeriodEnd)}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Billing status</span>
              <span>{statusInfo.label}</span>
            </div>
            {billing?.subscription?.cancelAtPeriodEnd && (
              <div style={{ ...styles.detailRow, color: '#dc2626' }}>
                <span style={styles.detailLabel}>Renewal</span>
                <span>Cancels at period end</span>
              </div>
            )}
          </div>

          <div style={styles.actions}>
            {billing?.stripeCustomerId ? (
              <button
                onClick={openPortal}
                disabled={portalLoading}
                style={styles.button}
              >
                {portalLoading ? 'Opening...' : 'Manage Subscription'}
              </button>
            ) : (
              <div style={styles.upgradeGrid}>
                {['starter', 'pro', 'enterprise'].map(plan => (
                  <button
                    key={plan}
                    onClick={() => handleUpgrade(plan)}
                    disabled={portalLoading || billing?.plan === plan}
                    style={{
                      ...styles.upgradeBtn,
                      opacity: billing?.plan === plan ? 0.5 : 1,
                    }}
                  >
                    {billing?.plan === plan ? 'Current' : `Upgrade to ${PLAN_LABELS[plan]?.split(' ')[0]}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeaderRow}>
            <h2 style={styles.cardTitle}>Current Period Usage</h2>
            <span style={styles.cardPill}>
              {formatDate(usage?.periodStart)} - {formatDate(usage?.periodEnd)}
            </span>
          </div>

          {currentPeriodCents == null && eventCount == null && !hasBreakdown ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyTitle}>No usage data yet</div>
              <p style={styles.emptyText}>Usage, invoice totals, and billable breakdowns will appear here when the API returns them.</p>
            </div>
          ) : (
            <div style={styles.usageBody}>
              <div style={styles.usageMetric}>
                <span style={styles.summaryLabel}>Current period spend</span>
                <span style={styles.usageValue}>{formatMoney(currentPeriodCents)}</span>
              </div>
              <div style={styles.usageMetric}>
                <span style={styles.summaryLabel}>Request count</span>
                <span style={styles.usageValue}>{formatCount(eventCount)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={styles.sectionCard}>
        <div style={styles.cardHeaderRow}>
          <h2 style={styles.cardTitle}>Invoice History</h2>
          <span style={styles.cardPill}>{formatCount(invoices.length)} invoices</span>
        </div>

        {invoices.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>No invoices yet</div>
            <p style={styles.emptyText}>Invoices will appear here once billing activity begins.</p>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeadRow}>
                  {['Invoice', 'Period', 'Items', 'Total', 'Status', 'Date'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, index) => (
                  <tr key={inv.id || `${inv.createdAt || 'invoice'}-${index}`} style={styles.tr}>
                    <td style={styles.tdMono}>
                      {inv.number || inv.id || 'Invoice'}
                    </td>
                    <td style={styles.tdMuted}>
                      {inv.periodStart || inv.periodEnd
                        ? `${formatDate(inv.periodStart)} - ${formatDate(inv.periodEnd)}`
                        : '—'}
                    </td>
                    <td style={styles.td}>
                      {inv.lineItemCount != null ? inv.lineItemCount : '—'}
                    </td>
                    <td style={styles.tdStrong}>
                      {formatMoney(pickCents(inv))}
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.invoicePill,
                          background: inv.status === 'paid' ? '#f0fdf4' : inv.status === 'pending' ? '#fffbeb' : '#f3f4f6',
                          color: inv.status === 'paid' ? '#16a34a' : inv.status === 'pending' ? '#d97706' : '#6b7280',
                        }}
                      >
                        {inv.status || 'unknown'}
                      </span>
                    </td>
                    <td style={styles.tdMuted}>
                      {formatDate(inv.paidAt || inv.createdAt || inv.dueAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasBreakdown && (
        <div style={styles.sectionCard}>
          <div style={styles.cardHeaderRow}>
            <h2 style={styles.cardTitle}>Billable Breakdown</h2>
            <span style={styles.cardPill}>Compact view</span>
          </div>

          <div style={styles.breakdownGrid}>
            <BreakdownSection title="By Model" items={modelBreakdown} accent="#3b5bdb" />
            <BreakdownSection title="By App" items={appBreakdown} accent="#0f766e" />
            <BreakdownSection title="By Task" items={taskBreakdown} accent="#d97706" />
          </div>

          {genericBreakdown.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <BreakdownSection title="Other Billable Items" items={genericBreakdown.slice(0, 5)} accent="#7c3aed" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '32px 24px 40px',
    color: '#1f2937',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 24,
  },
  title: {
    fontSize: 30,
    lineHeight: 1.1,
    fontWeight: 800,
    color: '#111827',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.9fr)',
    gap: 20,
    marginBottom: 20,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 24,
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  sectionCard: {
    background: '#fff',
    borderRadius: 16,
    padding: 24,
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    marginBottom: 20,
  },
  cardHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#111827',
  },
  cardPill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 999,
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  planDisplay: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 18,
  },
  planName: {
    fontSize: 26,
    fontWeight: 800,
    color: '#111827',
  },
  planMeta: {
    fontSize: 13,
    color: '#6b7280',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  summaryItem: {
    padding: 14,
    borderRadius: 12,
    background: '#f9fafb',
    border: '1px solid #eef2f7',
  },
  summaryLabel: {
    display: 'block',
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 800,
    color: '#111827',
  },
  usageBody: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
  },
  usageMetric: {
    padding: 16,
    borderRadius: 12,
    background: '#f9fafb',
    border: '1px solid #eef2f7',
  },
  usageValue: {
    fontSize: 22,
    fontWeight: 800,
    color: '#111827',
  },
  emptyState: {
    padding: 28,
    borderRadius: 14,
    background: '#f9fafb',
    border: '1px dashed #d1d5db',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#111827',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 1.5,
    color: '#6b7280',
  },
  subDetails: {
    borderTop: '1px solid #eef2f7',
    paddingTop: 12,
    marginTop: 8,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    fontSize: 14,
    color: '#374151',
    padding: '6px 0',
  },
  detailLabel: {
    color: '#6b7280',
  },
  actions: {
    marginTop: 16,
  },
  button: {
    width: '100%',
    padding: '14px 0',
    background: '#3b5bdb',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  upgradeGrid: {
    display: 'flex',
    gap: 12,
  },
  upgradeBtn: {
    flex: 1,
    padding: '12px 0',
    background: '#3b5bdb',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  successBanner: {
    padding: '12px 16px',
    background: '#f0fdf4',
    color: '#166534',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 16,
    border: '1px solid #bbf7d0',
  },
  warningBanner: {
    padding: '12px 16px',
    background: '#fffbeb',
    color: '#d97706',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 16,
    border: '1px solid #fde68a',
  },
  errorBanner: {
    padding: '12px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 16,
    border: '1px solid #fecaca',
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: 12,
    border: '1px solid #eef2f7',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  tableHeadRow: {
    background: '#f9fafb',
  },
  th: {
    textAlign: 'left',
    padding: '14px 16px',
    color: '#6b7280',
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #eef2f7',
  },
  tr: {
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '12px 16px',
    color: '#374151',
  },
  tdMuted: {
    padding: '12px 16px',
    color: '#6b7280',
  },
  tdStrong: {
    padding: '12px 16px',
    fontWeight: 700,
    color: '#111827',
  },
  tdMono: {
    padding: '12px 16px',
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#111827',
  },
  invoicePill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  breakdownGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 16,
  },
  breakdownCard: {
    borderRadius: 14,
    padding: 16,
    background: '#f9fafb',
    border: '1px solid #eef2f7',
  },
  breakdownList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  breakdownRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  breakdownRowHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  breakdownLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#111827',
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: 700,
  },
  barTrack: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    background: '#e5e7eb',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  breakdownMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 12,
    color: '#6b7280',
  },
};

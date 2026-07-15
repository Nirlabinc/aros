import { useState, useEffect } from 'react';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type Tab = 'overview' | 'invoices' | 'usage' | 'transactions' | 'license';

interface BillingAccount {
  id?: string;
  companyId?: string;
  balanceCents?: number;
  lifetimeSpendCents?: number;
  lifetimeRechargeCents?: number;
  autoRecharge?: boolean;
  rechargeThresholdCents?: number;
  rechargeAmountCents?: number;
  locked?: boolean;
}

interface Invoice {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  lineItemCount: number;
  status: string;
  createdAt: string;
  paidAt?: string;
}

interface CostSummary {
  totalCents?: number;
  eventCount?: number;
  byModel?: Array<{ model: string; totalCents: number; count: number }>;
  byAgent?: Array<{ agentId: string; agentName?: string; totalCents: number; count: number }>;
}

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  description?: string;
  triggeredBy?: string;
  createdAt: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const MODEL_FRIENDLY_NAMES: Record<string, string> = {
  'anthropic/claude-sonnet-4-6': 'AI Assistant',
  'anthropic/claude-sonnet-4-20250514': 'AI Assistant',
  'anthropic/claude-haiku-3-5': 'Quick Responder',
  'anthropic/claude-opus-4-6': 'Smart Analyzer',
  'openai/gpt-4o': 'AI Assistant Pro',
  'openai/gpt-4o-mini': 'Quick Responder',
  'aum/shre-70b': 'AUM (Local)',
  'ollama/shre-ft': 'AUM (legacy local)',
};

function friendlyModelName(model: string): string {
  if (MODEL_FRIENDLY_NAMES[model]) return MODEL_FRIENDLY_NAMES[model];
  // Strip provider prefix and clean up for display
  const name = model.replace(/^[^/]+\//, '').replace(/[-_]/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    paid: '#22c55e',
    pending: '#f59e0b',
    draft: '#6b7280',
    overdue: '#ef4444',
    void: '#6b7280',
  };
  const color = colors[status] || '#6b7280';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: `${color}22`,
      color,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

export function CostsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingAccount | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [licenseKey, setLicenseKey] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch user profile to get companyId
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch(`${API_BASE}/api/profile`, { credentials: 'include' });
        if (!res.ok) { setError('Could not load profile'); setLoading(false); return; }
        const data = await res.json();
        const membership = data.memberships?.[0];
        if (membership?.companyId) {
          setCompanyId(membership.companyId);
        } else {
          setError('No workspace found. Complete onboarding first.');
          setLoading(false);
        }
      } catch {
        setError('Could not connect to server');
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  // Fetch billing data when companyId is available
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError('');

    async function loadData() {
      try {
        const [billingRes, invoicesRes, costsRes, txnRes, licRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/companies/${companyId}/billing`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/companies/${companyId}/invoices`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/companies/${companyId}/costs/summary`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/companies/${companyId}/billing/transactions?limit=50`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/companies/${companyId}/licenses`, { credentials: 'include' }),
        ]);

        if (billingRes.status === 'fulfilled' && billingRes.value.ok) {
          setBilling(await billingRes.value.json());
        }
        if (invoicesRes.status === 'fulfilled' && invoicesRes.value.ok) {
          const inv = await invoicesRes.value.json();
          setInvoices(Array.isArray(inv) ? inv : []);
        }
        if (costsRes.status === 'fulfilled' && costsRes.value.ok) {
          setCostSummary(await costsRes.value.json());
        }
        if (txnRes.status === 'fulfilled' && txnRes.value.ok) {
          const txns = await txnRes.value.json();
          setTransactions(Array.isArray(txns) ? txns : []);
        }
        if (licRes.status === 'fulfilled' && licRes.value.ok) {
          const lics = await licRes.value.json();
          setLicenses(Array.isArray(lics) ? lics : []);
        }
      } catch {
        setError('Failed to load billing data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [companyId]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'usage', label: 'Usage' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'license', label: 'License Keys' },
  ];

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Costs & Billing</h1>
      <p style={{ color: '#94a3b8', marginBottom: 28, fontSize: 14 }}>
        Manage your subscription, view invoices, and track AI usage costs.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #334155', marginBottom: 28 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              color: tab === t.id ? '#818cf8' : '#94a3b8',
              borderBottom: tab === t.id ? '2px solid #818cf8' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: tab === t.id ? 600 : 400,
              fontSize: 14,
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading...</div>
      )}

      {error && !loading && (
        <div style={{
          padding: 20, borderRadius: 8, background: '#1e1b2e',
          border: '1px solid #ef444444', color: '#fca5a5', marginBottom: 20,
        }}>
          {error}
        </div>
      )}

      {!loading && !error && tab === 'overview' && (
        <OverviewTab billing={billing} costSummary={costSummary} invoiceCount={invoices.length} />
      )}

      {!loading && !error && tab === 'invoices' && (
        <InvoicesTab invoices={invoices} />
      )}

      {!loading && !error && tab === 'usage' && (
        <UsageTab costSummary={costSummary} />
      )}

      {!loading && !error && tab === 'transactions' && (
        <TransactionsTab transactions={transactions} />
      )}

      {!loading && !error && tab === 'license' && (
        <LicenseTab
          licenses={licenses}
          companyId={companyId!}
          licenseKey={licenseKey}
          keyCopied={keyCopied}
          onFetchKey={async (licId: string) => {
            try {
              const res = await fetch(`${API_BASE}/api/companies/${companyId}/licenses/${licId}/key`, { credentials: 'include' });
              if (res.ok) {
                const data = await res.json();
                setLicenseKey(data.key || '');
              }
            } catch { /* ignore */ }
          }}
          onCopy={() => {
            navigator.clipboard.writeText(licenseKey);
            setKeyCopied(true);
            setTimeout(() => setKeyCopied(false), 2000);
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({ billing, costSummary, invoiceCount }: {
  billing: BillingAccount | null;
  costSummary: CostSummary | null;
  invoiceCount: number;
}) {
  const cards = [
    {
      label: 'Credit Balance',
      value: billing?.balanceCents != null ? formatCents(billing.balanceCents) : '$0.00',
      sub: billing?.locked ? 'Account locked' : billing?.autoRecharge ? 'Auto-recharge on' : '',
      color: billing?.locked ? '#ef4444' : '#22c55e',
    },
    {
      label: 'Total Spend',
      value: billing?.lifetimeSpendCents != null ? formatCents(billing.lifetimeSpendCents) : '$0.00',
      sub: 'Lifetime',
      color: '#818cf8',
    },
    {
      label: 'AI Usage',
      value: costSummary?.totalCents != null ? formatCents(costSummary.totalCents) : '$0.00',
      sub: `${costSummary?.eventCount ?? 0} requests`,
      color: '#f59e0b',
    },
    {
      label: 'Invoices',
      value: String(invoiceCount),
      sub: 'Total generated',
      color: '#06b6d4',
    },
  ];

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16, marginBottom: 28,
      }}>
        {cards.map((c, i) => (
          <div key={i} style={{
            background: '#1e1b2e', borderRadius: 12, padding: '24px 20px',
            border: '1px solid #334155',
          }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {billing && (
        <div style={{
          background: '#1e1b2e', borderRadius: 12, padding: 24,
          border: '1px solid #334155',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Billing Settings</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px', fontSize: 14 }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Auto-recharge: </span>
              <span style={{ color: billing.autoRecharge ? '#22c55e' : '#ef4444' }}>
                {billing.autoRecharge ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Recharge threshold: </span>
              <span>{billing.rechargeThresholdCents != null ? formatCents(billing.rechargeThresholdCents) : 'N/A'}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Recharge amount: </span>
              <span>{billing.rechargeAmountCents != null ? formatCents(billing.rechargeAmountCents) : 'N/A'}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Lifetime recharged: </span>
              <span>{billing.lifetimeRechargeCents != null ? formatCents(billing.lifetimeRechargeCents) : '$0.00'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, color: '#94a3b8',
        background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>No invoices yet</div>
        <p>Invoices will appear here once billing activity begins.</p>
      </div>
    );
  }

  return (
    <div style={{
      background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #334155' }}>
            {['Invoice', 'Period', 'Items', 'Total', 'Status', 'Date'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '14px 16px', color: '#94a3b8',
                fontWeight: 500, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 13 }}>
                {inv.id.slice(0, 8)}...
              </td>
              <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                {formatDate(inv.periodStart)} - {formatDate(inv.periodEnd)}
              </td>
              <td style={{ padding: '12px 16px' }}>{inv.lineItemCount}</td>
              <td style={{ padding: '12px 16px', fontWeight: 600 }}>{formatCents(inv.totalCents)}</td>
              <td style={{ padding: '12px 16px' }}>{statusBadge(inv.status)}</td>
              <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{formatDate(inv.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageTab({ costSummary }: { costSummary: CostSummary | null }) {
  const byAgent = costSummary?.byAgent || [];
  const byModel = costSummary?.byModel || [];

  if (!costSummary || (byAgent.length === 0 && byModel.length === 0)) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, color: '#94a3b8',
        background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>No usage data yet</div>
        <p>AI usage costs will appear here as your agents process requests.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* By Agent */}
      <div style={{
        background: '#1e1b2e', borderRadius: 12, padding: 24,
        border: '1px solid #334155',
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Cost by Agent</h3>
        {byAgent.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 14 }}>No agent usage recorded</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byAgent.map((a, i) => {
              const maxCents = Math.max(...byAgent.map(x => x.totalCents), 1);
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span>{a.agentName || a.agentId}</span>
                    <span style={{ color: '#818cf8', fontWeight: 600 }}>{formatCents(a.totalCents)}</span>
                  </div>
                  <div style={{
                    height: 6, borderRadius: 3, background: '#334155',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 3, background: '#818cf8',
                      width: `${(a.totalCents / maxCents) * 100}%`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{a.count} requests</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* By Model */}
      <div style={{
        background: '#1e1b2e', borderRadius: 12, padding: 24,
        border: '1px solid #334155',
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Cost by Model</h3>
        {byModel.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 14 }}>No model usage recorded</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byModel.map((m, i) => {
              const maxCents = Math.max(...byModel.map(x => x.totalCents), 1);
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span>{friendlyModelName(m.model)}</span>
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{formatCents(m.totalCents)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: '#334155' }}>
                    <div style={{
                      height: '100%', borderRadius: 3, background: '#f59e0b',
                      width: `${(m.totalCents / maxCents) * 100}%`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{m.count} requests</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionsTab({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, color: '#94a3b8',
        background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>No transactions yet</div>
        <p>Billing transactions will appear here after recharges or usage.</p>
      </div>
    );
  }

  return (
    <div style={{
      background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #334155' }}>
            {['Type', 'Amount', 'Balance After', 'Description', 'Date'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '14px 16px', color: '#94a3b8',
                fontWeight: 500, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map(txn => (
            <tr key={txn.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{txn.type}</td>
              <td style={{
                padding: '12px 16px', fontWeight: 600,
                color: txn.amountCents >= 0 ? '#22c55e' : '#ef4444',
              }}>
                {txn.amountCents >= 0 ? '+' : ''}{formatCents(txn.amountCents)}
              </td>
              <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                {formatCents(txn.balanceAfterCents)}
              </td>
              <td style={{ padding: '12px 16px', color: '#94a3b8', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {txn.description || txn.triggeredBy || '-'}
              </td>
              <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{formatDate(txn.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LicenseTab({ licenses, companyId, licenseKey, keyCopied, onFetchKey, onCopy }: {
  licenses: any[];
  companyId: string;
  licenseKey: string;
  keyCopied: boolean;
  onFetchKey: (id: string) => void;
  onCopy: () => void;
}) {
  if (licenses.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 60, color: '#94a3b8',
        background: '#1e1b2e', borderRadius: 12, border: '1px solid #334155',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>No license keys</div>
        <p>License keys are issued during onboarding for self-hosted deployments.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {licenses.map((lic: any) => (
        <div key={lic.id} style={{
          background: '#1e1b2e', borderRadius: 12, padding: 24,
          border: '1px solid #334155',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{lic.tenantId}</span>
              <span style={{
                marginLeft: 12, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                background: lic.revoked ? '#ef444422' : lic.activated ? '#22c55e22' : '#f59e0b22',
                color: lic.revoked ? '#ef4444' : lic.activated ? '#22c55e' : '#f59e0b',
              }}>
                {lic.revoked ? 'Revoked' : lic.activated ? 'Activated' : 'Pending Activation'}
              </span>
            </div>
            <span style={{
              padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: '#818cf822', color: '#818cf8', textTransform: 'capitalize',
            }}>
              {lic.tier}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13, marginBottom: 16 }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Features: </span>
              <span>{(lic.features || []).join(', ') || 'Default'}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Expires: </span>
              <span>{lic.expiresAt ? formatDate(lic.expiresAt) : 'Never'}</span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Validations: </span>
              <span>{lic.validationCount || 0}</span>
            </div>
            {lic.activated && (
              <>
                <div>
                  <span style={{ color: '#94a3b8' }}>Host: </span>
                  <span>{lic.activatedHostname || 'Unknown'}</span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Fingerprint: </span>
                  <span style={{ fontFamily: 'monospace' }}>{lic.fingerprint || 'N/A'}</span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Last check-in: </span>
                  <span>{lic.lastValidatedAt ? formatDate(lic.lastValidatedAt) : 'Never'}</span>
                </div>
              </>
            )}
          </div>

          {!lic.revoked && (
            <div>
              {!licenseKey ? (
                <button
                  onClick={() => onFetchKey(lic.id)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: '#818cf8', color: '#fff', cursor: 'pointer',
                    fontWeight: 600, fontSize: 13,
                  }}
                >
                  Reveal License Key
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    readOnly
                    value={licenseKey}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid #334155', fontFamily: 'monospace', fontSize: 11,
                      background: '#0f0d1a', color: '#e2e8f0', overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={onCopy}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: keyCopied ? '#22c55e' : '#818cf8', color: '#fff',
                      cursor: 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap',
                    }}
                  >
                    {keyCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                Your license key activates your AROS subscription. Keep it safe.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

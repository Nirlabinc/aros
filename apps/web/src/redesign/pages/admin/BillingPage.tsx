import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Card, Grid, Loading, State } from './AdminPrimitives';
import { postAdmin, useAdminRequest } from './adminApi';

export type BillingStatus = { plan?: string; licenseTier?: string; billingStatus?: string; stripeCustomerId?: string | null; currentPeriodSpendCents?: number; invoiceCount?: number; subscription?: { status?: string; currentPeriodEnd?: string } | null; error?: string };
const money = (cents?: number) => cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
export function BillingPage() {
  const { tenant, user, session } = useAuth(); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState('');
  const path = tenant?.id ? `/api/billing/status?tenantId=${encodeURIComponent(tenant.id)}` : null;
  const { data, loading, error, retry } = useAdminRequest<BillingStatus>(path);
  async function act(kind: 'portal' | 'checkout') { if (!tenant) return; setBusy(true); setActionError(''); try { const result = await postAdmin(`/api/billing/${kind}`, kind === 'portal' ? { stripeCustomerId: data?.stripeCustomerId } : { tenantId: tenant.id, plan: 'pro', email: user?.email }, session?.access_token); if (!result?.url) throw new Error('Billing provider did not return a destination.'); window.location.assign(result.url); } catch (e) { setActionError(e instanceof Error ? e.message : 'Billing action failed.'); } finally { setBusy(false); } }
  return <AdminPage eyebrow="Workspace · Billing" lead="Your subscription and billing status from the AROS billing service." action={data && <Button disabled={busy} onClick={() => void act(data.stripeCustomerId ? 'portal' : 'checkout')}>{busy ? 'Opening…' : data.stripeCustomerId ? 'Manage billing' : 'Upgrade plan'}</Button>}>
    {!tenant ? <State title="No workspace selected" detail="Choose a workspace to view billing." /> : loading ? <Loading /> : error || data?.error ? <State title="Billing unavailable" detail={error || data?.error || 'Unknown billing error'} retry={retry} /> : !data ? <State title="No billing record" detail="This workspace has no subscription data yet." /> : <><Grid><Card title="Plan" value={data.plan || data.licenseTier || 'Free'} /><Card title="Status" value={data.billingStatus || data.subscription?.status || 'Not subscribed'} /><Card title="Current period" value={money(data.currentPeriodSpendCents)} /><Card title="Invoices" value={data.invoiceCount ?? '—'} /></Grid>{actionError && <State title="Billing action failed" detail={actionError} />}</>}
  </AdminPage>;
}

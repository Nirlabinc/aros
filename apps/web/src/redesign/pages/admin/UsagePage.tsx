import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Card, Grid, Loading, Row, Rows, State } from './AdminPrimitives';
import { type BillingStatus } from './BillingPage';
import { useAdminRequest } from './adminApi';

type Item = { label?: string; name?: string; model?: string; app?: string; task?: string; count?: number; totalCents?: number; amountCents?: number };
type UsageStatus = BillingStatus & { currentPeriodEventCount?: number; currentPeriodUsage?: { totalCents?: number; eventCount?: number; byModel?: Item[]; byApp?: Item[]; byTask?: Item[]; billableBreakdown?: Item[] } };
const money = (cents?: number) => cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
export function UsagePage() {
  const { tenant } = useAuth(); const { data, loading, error, retry } = useAdminRequest<UsageStatus>(tenant?.id ? `/api/billing/status?tenantId=${encodeURIComponent(tenant.id)}` : null);
  const usage = data?.currentPeriodUsage; const items = [...(usage?.byModel || []), ...(usage?.byApp || []), ...(usage?.byTask || []), ...(usage?.billableBreakdown || [])];
  return <AdminPage eyebrow="Workspace · Usage" lead="Billable AI activity returned by the AROS billing service.">{!tenant ? <State title="No workspace selected" detail="Choose a workspace to view usage." /> : loading ? <Loading /> : error ? <State title="Usage unavailable" detail={error} retry={retry} /> : !usage && data?.currentPeriodSpendCents == null && data?.currentPeriodEventCount == null ? <State title="No usage recorded" detail="Usage appears after agents process billable requests." /> : <><Grid><Card title="Current spend" value={money(usage?.totalCents ?? data?.currentPeriodSpendCents)} /><Card title="Events" value={(usage?.eventCount ?? data?.currentPeriodEventCount)?.toLocaleString() ?? '—'} /></Grid>{items.length > 0 && <Rows>{items.map((item, i) => <Row key={`${item.model || item.app || item.task || item.name}-${i}`} title={item.label || item.name || item.model || item.app || item.task || 'Unlabelled usage'} detail={`${item.count ?? 0} events`} end={<strong>{money(item.totalCents ?? item.amountCents)}</strong>} />)}</Rows>}</>}
  </AdminPage>;
}

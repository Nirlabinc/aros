import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Card, Grid, Loading, Pill, Row, Rows, State } from './AdminPrimitives';
import { useAdminRequest } from './adminApi';

type Connector = { id?: string; name?: string; type?: string; status?: string; last_error?: string; last_tested?: string };
export function ConnectionHealthPage() {
  const { tenant } = useAuth();
  const { data, loading, error, retry } = useAdminRequest<{ connectors?: Connector[] }>(tenant ? '/api/connectors' : null);
  if (!tenant) return <AdminPage eyebrow="Observability" lead="Monitor the services connected to this workspace."><State title="No workspace selected" detail="Choose a workspace to inspect its connections." /></AdminPage>;
  const connectors = Array.isArray(data?.connectors) ? data!.connectors! : [];
  const healthy = connectors.filter(item => item.status === 'connected' || item.status === 'healthy').length;
  const failed = connectors.filter(item => item.status === 'error' || item.status === 'down').length;
  return <AdminPage eyebrow="Observability" lead="Live connector status, recent checks, and actionable failures." action={<Button onClick={retry} disabled={loading}>Run all checks</Button>}>
    {loading ? <Loading /> : error ? <State title="Connection checks failed" detail={error} retry={retry} /> : connectors.length === 0 ? <State title="No connections yet" detail="Connect a register or app and its health will appear here." /> : <><Grid><Card title="Healthy" value={healthy} /><Card title="Needs attention" value={connectors.length - healthy - failed} /><Card title="Failed" value={failed} /></Grid><Rows>{connectors.map((item, i) => <Row key={item.id || `${item.type}-${i}`} mark={(item.name || item.type || '?').slice(0, 2).toUpperCase()} title={item.name || item.type || 'Unnamed connection'} detail={item.last_error || item.last_tested || 'No check detail returned'} end={<Pill>{item.status || 'unknown'}</Pill>} />)}</Rows></>}
  </AdminPage>;
}

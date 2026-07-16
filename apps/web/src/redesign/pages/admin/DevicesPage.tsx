import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Card, Grid, Loading, Pill, Row, Rows, State } from './AdminPrimitives';
import { useAdminRequest } from './adminApi';

type Heartbeat = {
  lastSuccessfulLogin?: string; lastCloudUpload?: string; lastReportReceived?: string;
  queueDepth?: number; lastErrorCategory?: string; commanderReachable?: boolean;
  serviceVersion?: string; connectorVersion?: string;
};
type Device = {
  id: string; deviceName?: string; machineId: string; operatingSystem?: string | null;
  architecture?: string | null; serviceVersion?: string | null; connectorVersion?: string | null;
  status: string; provider: string; createdAt: string; lastHeartbeatAt?: string | null;
  revokedAt?: string | null; latestHeartbeat?: Heartbeat | null;
};

const ACTIVE_WINDOW_MS = 10 * 60_000;
function relative(value?: string | null) {
  if (!value) return 'Never';
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return value;
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
function timestamp(value?: string | null) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toLocaleString()} (${relative(value)})`;
}
function isActive(device: Device) {
  return !device.revokedAt && Boolean(device.lastHeartbeatAt) && Date.now() - Date.parse(device.lastHeartbeatAt!) <= ACTIVE_WINDOW_MS;
}

export function DevicesPage() {
  const { tenant } = useAuth();
  const { data, loading, error, retry } = useAdminRequest<{ devices?: Device[] }>(tenant ? '/api/edge/devices' : null);
  const devices = Array.isArray(data?.devices) ? data!.devices! : [];
  const active = devices.filter(isActive).length;
  const attention = devices.filter(device => !device.revokedAt && !isActive(device)).length;
  return <AdminPage eyebrow="Node ecosystem" lead="Every enrolled computer has its own device identity. Monitor where it is running, what version it uses, and when it last authenticated or contributed activity." action={<Button onClick={retry} disabled={loading}>Refresh</Button>}>
    {!tenant ? <State title="No workspace selected" detail="Choose a workspace to view its enrolled computers." />
      : loading ? <Loading />
      : error ? <State title="Computers unavailable" detail={error} retry={retry} />
      : devices.length === 0 ? <State title="No computers enrolled" detail="Enroll a computer from a store connection and it will appear here with its operating status and activity." />
      : <><Grid><Card title="Enrolled" value={devices.length} /><Card title="Active now" value={active} /><Card title="Needs attention" value={attention} /><Card title="Revoked" value={devices.filter(device => device.revokedAt).length} /></Grid>
        <Rows>{devices.map(device => {
          const heartbeat = device.latestHeartbeat || {};
          const activeNow = isActive(device);
          const state = device.revokedAt ? 'Revoked' : activeNow ? 'Active' : device.status === 'degraded' ? 'Degraded' : 'Offline';
          const os = [device.operatingSystem || 'OS unknown', device.architecture].filter(Boolean).join(' · ');
          const versions = `Agent ${device.serviceVersion || heartbeat.serviceVersion || 'unknown'} · Connector ${device.connectorVersion || heartbeat.connectorVersion || 'unknown'}`;
          const activity = heartbeat.lastErrorCategory ? `Last error: ${heartbeat.lastErrorCategory}`
            : heartbeat.queueDepth ? `${heartbeat.queueDepth} events queued`
            : heartbeat.lastCloudUpload ? `Cloud activity ${relative(heartbeat.lastCloudUpload)}` : 'No cloud activity reported';
          return <Row key={device.id} mark={(device.operatingSystem || device.provider || 'PC').slice(0, 2).toUpperCase()}
            title={device.deviceName || device.machineId}
            detail={`${os} · ${versions} · Last seen ${timestamp(device.lastHeartbeatAt)} · Last login ${timestamp(heartbeat.lastSuccessfulLogin)} · ${activity}`}
            end={<Pill>{state}</Pill>} />;
        })}</Rows></>}
  </AdminPage>;
}

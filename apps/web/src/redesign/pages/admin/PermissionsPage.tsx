import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Loading, Pill, Row, Rows, State } from './AdminPrimitives';
import { workspaceApi, type WorkspaceMember } from './workspaceApi';

const ROLE_SCOPE: Record<string, string> = {
  owner: 'Full workspace, billing, connection, member, and policy administration',
  admin: 'Manage connections, apps, skills, agents, and members; owner-only billing excluded',
  member: 'Chat and approved read capabilities; write actions remain approval-gated',
};

export function PermissionsPage() {
  const { tenant, session } = useAuth(); const auth = useMemo(() => tenant ? { workspaceId: tenant.id, accessToken: session?.access_token } : null, [tenant?.id, session?.access_token]);
  const [roles, setRoles] = useState<WorkspaceMember[]>([]); const [loading, setLoading] = useState(Boolean(auth)); const [error, setError] = useState('');
  async function load() { if (!auth) return; setLoading(true); setError(''); try { setRoles(await workspaceApi.roles(auth)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load roles'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  return <AdminPage eyebrow="Governance · Permissions" lead="Verified workspace roles and their enforced AROS scopes.">{!auth ? <State title="No workspace selected" detail="Choose a workspace to review access." /> : loading ? <Loading /> : error ? <State title="Permissions unavailable" detail={error} retry={() => void load()} /> : <><Rows>{roles.map(member => <Row key={member.id} mark={(member.membershipRole || 'member').slice(0, 2).toUpperCase()} title={member.user?.name || member.user?.email || member.principalId} detail={ROLE_SCOPE[member.membershipRole] || 'Custom role'} end={<Pill>{member.membershipRole}</Pill>} />)}</Rows><State title="Approval gates active" detail="Role changes are tenant-scoped and audited. Store price, reorder, and outbound-send actions still require explicit approval." /></>}
  </AdminPage>;
}

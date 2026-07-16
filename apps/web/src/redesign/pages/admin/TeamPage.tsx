import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Loading, Pill, Row, Rows, State } from './AdminPrimitives';
import { workspaceApi, type WorkspaceMember } from './workspaceApi';

export function TeamPage() {
  const { user, tenant, session, memberships } = useAuth();
  const auth = useMemo(() => tenant ? { workspaceId: tenant.id, accessToken: session?.access_token } : null, [tenant?.id, session?.access_token]);
  const viewerRole = memberships.find(item => item.tenant_id === tenant?.id)?.role || 'member'; const canManage = viewerRole === 'owner' || viewerRole === 'admin';
  const [members, setMembers] = useState<WorkspaceMember[]>([]); const [loading, setLoading] = useState(Boolean(auth)); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  async function load() { if (!auth) return; setLoading(true); setError(''); try { setMembers(await workspaceApi.members(auth)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load members'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  async function changeRole(member: WorkspaceMember, role: string) { if (!auth || role === member.membershipRole) return; if (!window.confirm(`Change ${member.user?.name || 'this member'} from ${member.membershipRole} to ${role}?`)) return; setBusy(member.id); setError(''); try { await workspaceApi.updateRole(auth, member.id, role); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Role update failed'); } finally { setBusy(''); } }
  async function remove(member: WorkspaceMember) { if (!auth || !window.confirm(`Remove ${member.user?.name || 'this member'} from ${tenant?.name}? This revokes workspace access.`)) return; setBusy(member.id); setError(''); try { await workspaceApi.removeMember(auth, member.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Member removal failed'); } finally { setBusy(''); } }
  return <AdminPage eyebrow="Workspace · Team" lead="People with access to this workspace, using the same member contract as MIB.">
    {!auth ? <State title="No workspace selected" detail="Choose a workspace to view its team." /> : loading ? <Loading /> : error && members.length === 0 ? <State title="Team unavailable" detail={error} retry={() => void load()} /> : members.length === 0 ? <State title="No members" detail="No active or pending workspace memberships were returned." /> : <><Rows>{members.map(member => <Row key={member.id} mark={(member.user?.name || 'M').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()} title={member.user?.name || 'Member'} detail={`${member.user?.email || member.principalId} · ${member.status}`} end={canManage ? <span style={{ display: 'flex', gap: 8 }}><select disabled={busy === member.id} value={member.membershipRole} aria-label={`Role for ${member.user?.name || 'member'}`} onChange={e => void changeRole(member, e.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select>{member.principalId !== user?.id && <Button disabled={busy === member.id} onClick={() => void remove(member)}>Remove</Button>}</span> : <Pill>{member.membershipRole}</Pill>} />)}</Rows>{error && <State title="Team update failed" detail={error} />}</>}
  </AdminPage>;
}

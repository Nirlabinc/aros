import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Loading, Pill, State } from './AdminPrimitives';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type CatalogEntry = { id: string; label: string; description: string };
type Channel = { id: string; label: string; status: 'active' | 'activating' | 'pending-provider'; destinationHint: string };
type Pref = { event: string; channel: string; enabled: boolean; destination: string | null };
type Automation = {
  id: string;
  channel: 'email' | 'sms';
  status: 'active' | 'pending_connector' | 'suspended' | 'disabled';
  created_at: string;
  last_checked: string | null;
  last_fired: string | null;
  description: string;
};

const STATUS_LABEL: Record<Automation['status'], string> = {
  active: 'active',
  pending_connector: 'waiting on store connection',
  suspended: 'paused — too many alerts',
  disabled: 'disabled',
};

const btnStyle: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)',
  borderRadius: 9, padding: '6px 12px', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: 13,
};

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Per-user notification preferences (event × channel), honest about delivery:
 * choices persist immediately; each channel states whether its delivery lane
 * is live yet, so a toggle never silently implies an email/text that cannot
 * be sent today.
 */
export function NotificationsPage() {
  const { user, tenant, session, memberships } = useAuth();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoError, setAutoError] = useState('');
  const [autoBusy, setAutoBusy] = useState('');

  const role = useMemo(() => memberships.find((m) => m.tenant.id === tenant?.id)?.role, [memberships, tenant?.id]);
  const canManage = role === 'owner' || role === 'admin';

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  }), [session?.access_token, tenant?.id]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/notifications/preferences`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCatalog(data.catalog || []); setChannels(data.channels || []); setPrefs(data.preferences || []);
      const dests: Record<string, string> = {};
      for (const p of data.preferences || []) if (p.destination) dests[`${p.channel}`] = p.destination;
      setDestinations(dests);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load preferences'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (session) void load(); }, [session?.access_token, tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAutomations() {
    setAutoLoading(true); setAutoError('');
    try {
      const res = await fetch(`${API_BASE}/api/automations`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAutomations((data.automations || []) as Automation[]);
    } catch (e) { setAutoError(e instanceof Error ? e.message : 'Could not load your automation rules'); }
    finally { setAutoLoading(false); }
  }
  useEffect(() => { if (session) void loadAutomations(); }, [session?.access_token, tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutateAutomation(id: string, action: 'enable' | 'disable' | 'delete') {
    setAutoBusy(id); setNote('');
    try {
      const res = action === 'delete'
        ? await fetch(`${API_BASE}/api/automations/${id}`, { method: 'DELETE', headers })
        : await fetch(`${API_BASE}/api/automations/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ enabled: action === 'enable' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
      await loadAutomations();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not update the rule'); }
    finally { setAutoBusy(''); }
  }

  function prefFor(event: string, channel: string): Pref | undefined {
    return prefs.find((p) => p.event === event && p.channel === channel);
  }

  async function save(event: string, channel: string, enabled: boolean) {
    const key = `${event}:${channel}`;
    setBusy(key); setNote('');
    try {
      const destination = destinations[channel]?.trim() || null;
      const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
        method: 'PUT', headers,
        body: JSON.stringify({ event, channel, enabled, destination }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPrefs((current) => {
        const next = current.filter((p) => !(p.event === event && p.channel === channel));
        next.push({ event, channel, enabled, destination });
        return next;
      });
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(''); }
  }

  async function saveDestination(channel: string) {
    // Re-save every enabled pref on this channel with the new destination.
    setNote('');
    const enabledEvents = catalog.filter((c) => prefFor(c.id, channel)?.enabled);
    for (const event of enabledEvents) await save(event.id, channel, true);
    setNote(enabledEvents.length ? 'Destination updated.' : 'Destination will apply when you enable a notification on this channel.');
  }

  return (
    <AdminPage eyebrow="Workspace · Notifications" lead="Choose what reaches you and where. Choices apply to this workspace and take effect the moment each delivery channel is live.">
      {!session ? <State title="Sign in required" detail="Sign in to manage notification preferences." />
        : loading ? <Loading />
        : error ? <State title="Preferences unavailable" detail={error} retry={() => void load()} />
        : (
          <div style={{ display: 'grid', gap: 18 }}>
            <section style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: 18, boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                <strong style={{ fontSize: 15 }}>Automation rules</strong>
                <Pill>created in chat</Pill>
              </div>
              <p style={{ color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.5, margin: '0 0 12px' }}>
                Alerts you set up by chatting (e.g. "text me when someone voids a transaction"). Manage them here; create new ones from chat.
              </p>
              {autoLoading ? <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '6px 0' }}>Loading your rules…</div>
                : autoError ? <State title="Rules unavailable" detail={autoError} retry={() => void loadAutomations()} />
                : automations.length === 0 ? (
                  <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '6px 0' }}>
                    No automation rules yet. In chat, try: <em>"text me when someone voids a transaction"</em>.
                  </div>
                ) : (
                  <div>
                    {automations.map((a) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                        <span style={{ flex: '1 1 260px', minWidth: 200 }}>
                          <strong style={{ display: 'block', fontSize: 13.5 }}>{a.description}</strong>
                          <span style={{ color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.5 }}>
                            {STATUS_LABEL[a.status]} · checked {ago(a.last_checked)} · last fired {ago(a.last_fired)}
                          </span>
                        </span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          {canManage ? (
                            <>
                              {a.status === 'disabled'
                                ? <button type="button" disabled={autoBusy === a.id} onClick={() => void mutateAutomation(a.id, 'enable')} style={btnStyle}>Enable</button>
                                : <button type="button" disabled={autoBusy === a.id} onClick={() => void mutateAutomation(a.id, 'disable')} style={btnStyle}>Disable</button>}
                              <button type="button" disabled={autoBusy === a.id} onClick={() => void mutateAutomation(a.id, 'delete')} style={{ ...btnStyle, color: 'var(--danger, #b91c1c)' }}>Delete</button>
                            </>
                          ) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>owner/admin manages</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </section>
            {channels.map((channel) => (
              <section key={channel.id} style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: 18, boxShadow: 'var(--shadow-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15 }}>{channel.label}</strong>
                  {channel.status === 'active'
                    ? <Pill>delivery live</Pill>
                    : channel.status === 'activating'
                      ? <Pill>delivery activating — choices apply from the first send</Pill>
                      : <Pill>provider not connected yet — choices saved for activation</Pill>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 6px', flexWrap: 'wrap' }}>
                  <input
                    type={channel.id === 'email' ? 'email' : 'tel'}
                    placeholder={channel.id === 'email' ? (user?.email || 'you@store.com') : '+1 (555) 555-0100'}
                    aria-label={`${channel.label} destination`}
                    value={destinations[channel.id] || ''}
                    onChange={(e) => setDestinations((d) => ({ ...d, [channel.id]: e.target.value }))}
                    style={{ flex: '1 1 240px', minWidth: 200, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 9, padding: '8px 12px', font: 'inherit' }}
                  />
                  <button
                    type="button" disabled={busy !== ''}
                    onClick={() => void saveDestination(channel.id)}
                    style={{ border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 9, padding: '8px 13px', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
                  >Save destination</button>
                  <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--ink-3)' }}>{channel.destinationHint}</span>
                </div>
                <div>
                  {catalog.map((event) => {
                    const pref = prefFor(event.id, channel.id);
                    const key = `${event.id}:${channel.id}`;
                    return (
                      <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                        <input
                          type="checkbox" checked={Boolean(pref?.enabled)} disabled={busy === key}
                          onChange={(e) => void save(event.id, channel.id, e.target.checked)}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          <strong style={{ display: 'block', fontSize: 13.5 }}>{event.label}</strong>
                          <span style={{ color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.5 }}>{event.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
            {note && <State title="Notifications" detail={note} />}
          </div>
        )}
    </AdminPage>
  );
}

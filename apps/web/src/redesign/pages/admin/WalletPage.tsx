import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { AdminPage, Button, Grid, Card, Loading, State } from './AdminPrimitives';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

type Wallet = {
  balanceUsd: number; creditsUsd: number; usageUsd: number; frozen: boolean;
  autoRecharge: { autoRechargeEnabled: boolean; autoRechargeThresholdUsd: number; autoRechargeAmountUsd: number; hasCard: boolean };
};
const money = (n?: number) => n == null ? '—' : `$${n.toFixed(2)}`;
const PRESETS = [10, 25, 50, 100];

/**
 * Prepaid wallet: dollar balance, add-credit (hosted Stripe checkout), and
 * auto-recharge (available once a card is on file from any top-up). Balance
 * is computed server-side (credits − metered usage) so it's always accurate.
 */
export function WalletPage() {
  const { tenant, session } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [custom, setCustom] = useState('');
  const [threshold, setThreshold] = useState(10);
  const [amount, setAmount] = useState(25);
  const [note, setNote] = useState('');

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
  }), [session?.access_token, tenant?.id]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/wallet`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setWallet(data);
      setThreshold(data.autoRecharge.autoRechargeThresholdUsd);
      setAmount(data.autoRecharge.autoRechargeAmountUsd);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load wallet'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (session) void load();
    // Returning from a successful Stripe top-up: reload after the webhook lands.
    if (new URLSearchParams(window.location.search).get('topup') === 'success') {
      setNote('Payment received — your balance updates within a few seconds.');
      setTimeout(() => void load(), 3500);
    }
  }, [session?.access_token, tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCredit(usd: number) {
    if (!usd || usd < 5) { setNote('Minimum top-up is $5.'); return; }
    setBusy('topup'); setNote('');
    try {
      const res = await fetch(`${API_BASE}/api/wallet/topup`, { method: 'POST', headers, body: JSON.stringify({ amountUsd: usd }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      window.location.href = data.url; // hosted Stripe checkout
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not start checkout'); setBusy(''); }
  }

  async function saveAutoRecharge(enabled: boolean) {
    setBusy('auto'); setNote('');
    try {
      const res = await fetch(`${API_BASE}/api/wallet/auto-recharge`, { method: 'POST', headers, body: JSON.stringify({ enabled, thresholdUsd: threshold, amountUsd: amount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setNote(enabled ? `Auto-recharge on: we'll add $${amount} whenever your balance drops to $${threshold}.` : 'Auto-recharge turned off.');
      await load();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(''); }
  }

  if (!session) return <AdminPage eyebrow="Workspace · Wallet" lead="Sign in to manage your balance."><State title="Sign in required" detail="" /></AdminPage>;

  const ar = wallet?.autoRecharge;
  const low = wallet && wallet.balanceUsd <= 5 && !wallet.frozen;

  return (
    <AdminPage eyebrow="Workspace · Wallet" lead="Your prepaid balance for AI usage. Bring your own model or key and it's free; our hosted models and cloud passthrough draw down the balance.">
      {loading ? <Loading /> : error ? <State title="Wallet unavailable" detail={error} retry={() => void load()} /> : wallet && (
        <div style={{ display: 'grid', gap: 18 }}>
          {/* Balance hero */}
          <article style={{ border: `1px solid ${wallet.frozen ? 'var(--danger-line)' : 'var(--line)'}`, borderRadius: 16, background: wallet.frozen ? 'var(--danger-soft)' : 'var(--surface)', padding: 24, boxShadow: 'var(--shadow-card)' }}>
            <div style={{ color: 'var(--ink-2)', fontSize: 13 }}>Current balance</div>
            <div style={{ fontSize: 40, fontWeight: 800, color: wallet.frozen ? 'var(--danger-ink)' : 'var(--ink)', marginTop: 4 }}>{money(wallet.balanceUsd)}</div>
            {wallet.frozen && <div style={{ color: 'var(--danger-ink)', fontSize: 13.5, marginTop: 6 }}>Out of credit — add funds to keep using AI. (Your own model or API key keeps working for free.)</div>}
            {low && <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 6 }}>Running low — consider topping up or turning on auto-recharge.</div>}
          </article>

          <Grid>
            <Card title="Credits added" value={money(wallet.creditsUsd)} />
            <Card title="Used so far" value={money(wallet.usageUsd)} />
            <Card title="Auto-recharge" value={ar?.autoRechargeEnabled ? 'On' : 'Off'} />
          </Grid>

          {/* Add credit */}
          <section style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: 18, boxShadow: 'var(--shadow-card)' }}>
            <strong style={{ fontSize: 15 }}>Add credit</strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {PRESETS.map(p => <Button key={p} disabled={busy === 'topup'} onClick={() => void addCredit(p)}>${p}</Button>)}
              <input type="number" min={5} step={5} placeholder="Custom $" value={custom} onChange={e => setCustom(e.target.value)} style={{ width: 110, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 9, padding: '8px 12px', font: 'inherit' }} />
              <Button disabled={busy === 'topup' || !custom} onClick={() => void addCredit(Number(custom))}>{busy === 'topup' ? 'Starting…' : 'Add custom'}</Button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Secure checkout by Stripe. Your card is saved so you can enable auto-recharge.</div>
          </section>

          {/* Auto-recharge */}
          <section style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: 18, boxShadow: 'var(--shadow-card)' }}>
            <strong style={{ fontSize: 15 }}>Auto-recharge</strong>
            {!ar?.hasCard ? (
              <div style={{ color: 'var(--ink-2)', fontSize: 13.5, marginTop: 8 }}>Add credit once to save a card, then you can turn on auto-recharge here.</div>
            ) : (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>When balance drops to</span>
                  <input type="number" min={0} step={5} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: 80, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 8, padding: '6px 10px', font: 'inherit' }} />
                  <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>, add</span>
                  <input type="number" min={5} step={5} value={amount} onChange={e => setAmount(Number(e.target.value))} style={{ width: 80, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 8, padding: '6px 10px', font: 'inherit' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {ar.autoRechargeEnabled
                    ? <><Button disabled={busy === 'auto'} onClick={() => void saveAutoRecharge(true)}>Update</Button><Button disabled={busy === 'auto'} onClick={() => void saveAutoRecharge(false)}>Turn off</Button></>
                    : <Button disabled={busy === 'auto'} onClick={() => void saveAutoRecharge(true)}>{busy === 'auto' ? 'Saving…' : 'Turn on auto-recharge'}</Button>}
                </div>
              </div>
            )}
          </section>

          {note && <State title="Wallet" detail={note} />}
        </div>
      )}
    </AdminPage>
  );
}

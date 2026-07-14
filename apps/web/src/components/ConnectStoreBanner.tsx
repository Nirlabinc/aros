import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

/**
 * Persistent banner shown above the dashboard while the tenant has no
 * connected store — makes "you're looking at sample data" explicit and
 * keeps the connect action one click away.
 */
export function ConnectStoreBanner() {
  const { session, tenant } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/connectors`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(tenant?.id ? { 'x-aros-tenant-id': tenant.id } : {}),
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        const connected = (data.connectors || []).some((c: { status: string }) => c.status === 'connected');
        if (!cancelled) setShow(!connected);
      } catch { /* banner is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [session, tenant]);

  if (!show) return null;

  return (
    <div style={styles.bar}>
      <span style={styles.dot} />
      <span style={styles.text}>
        You&apos;re viewing <strong>sample data</strong> — connect your store to see real numbers.
      </span>
      <a href="/connect" style={styles.cta}>Connect your store</a>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 12,
    padding: '10px 16px',
    margin: '0 0 16px',
    fontSize: 13,
    color: '#78350f',
  },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 },
  text: { flex: 1, minWidth: 0 },
  cta: {
    background: '#3b5bdb',
    color: '#fff',
    textDecoration: 'none',
    padding: '7px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
};

import { useState, useCallback, useEffect } from 'react';
import { useWhitelabel } from '../whitelabel/WhitelabelProvider';
import { useAuth } from '../admin/useAuth';
import { TenantPicker } from './TenantPicker';

export function Sidebar() {
  const { config } = useWhitelabel();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const path = window.location.pathname;

  const toggle = useCallback(() => setOpen(prev => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  // Close sidebar on navigation (popstate) and escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onPop = () => close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, [close]);

  return (
    <>
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        className="aros-hamburger"
        onClick={toggle}
        aria-label={open ? 'Close menu' : 'Open menu'}
        type="button"
      >
        {open ? '\u2715' : '\u2630'}
      </button>

      {/* Overlay — visible only on mobile when sidebar is open */}
      <div
        className={`aros-sidebar-overlay${open ? ' aros-sidebar-overlay--visible' : ''}`}
        onClick={close}
      />

      <aside className={`aros-sidebar${open ? ' aros-sidebar--open' : ''}`}>
        <div className="aros-sidebar-header">
          <img src={config.logo?.primary} alt={config.brand.name} className="aros-logo" />
          <span className="aros-brand-name">{config.brand.name}</span>
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <TenantPicker />
        </div>
        <nav className="aros-nav">
          <div className="aros-nav-label">Workspace</div>
          <Nav href="/dashboard" label="Chat" icon="◈" path={path} onClick={close} />
          <Nav href="/channels" label="Channels" icon="⌁" path={path} onClick={close} />
          <Nav href="/stores" label="Stores & POS" icon="▣" path={path} onClick={close} />
          <Nav href="/apps" label="Apps" icon="⌁" path={path} onClick={close} />
          <Nav href="/agents" label="Agents" icon="◎" path={path} onClick={close} />
          <Nav href="/skills" label="Skills" icon="✣" path={path} onClick={close} />
          <Nav href="/models" label="Models" icon="✦" path={path} onClick={close} />
          <Nav href="/connection-health" label="Connection health" icon="◉" path={path} onClick={close} />
          <div className="aros-nav-label">Administration</div>
          <Nav href="/settings" label="Settings" icon="⚙" path={path} onClick={close} />
          <Nav href="/profile" label="Profile" icon="○" path={path} onClick={close} />
          <Nav href="/billing" label="Cost & billing" icon="$" path={path} onClick={close} />
          <Nav href="/users" label="Users" icon="♙" path={path} onClick={close} />
          <Nav href="/workspace" label="Workspace" icon="◇" path={path} onClick={close} />
          {config.features?.marketplace && <Nav href="/marketplace" label="Marketplace" icon="＋" path={path} onClick={close} />}
          {isAdmin && <a href="/admin" className="aros-nav-item" onClick={close}>Admin</a>}
        </nav>
      </aside>
    </>
  );
}

function Nav({ href, label, icon, path, onClick }: { href: string; label: string; icon: string; path: string; onClick: () => void }) {
  const active = path === href || path.startsWith(`${href}/`);
  return <a href={href} className={`aros-nav-item${active ? ' active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}</a>;
}

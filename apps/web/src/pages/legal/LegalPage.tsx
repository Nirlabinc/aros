/**
 * Public /legal/terms and /legal/privacy pages.
 *
 * PLACEHOLDER pending attorney review — these intentionally do NOT contain
 * the full legal prose. Once counsel signs off, paste the final documents
 * here (or point these routes at the hosted legal site), remove the DRAFT
 * banner, and bump TERMS_VERSION / PRIVACY_VERSION in src/terms/constants.ts
 * so existing users are re-gated on the real text.
 */

const TERMS_SECTIONS = [
  'Agreement to Terms and acceptance mechanics (clickwrap)',
  'AI-Generated Content Disclaimer — output may be inaccurate; verify before acting; not professional advice; drafted actions execute only on your confirmation',
  'Disclaimer of Warranties (AI output provided “as is” and “as available”)',
  'Limitation of Liability (capped; statutory carve-outs apply)',
  'Service Data, Usage Data & AI Improvement — including the organization-admin opt-out of cross-customer model training',
  'Term, termination, and governing law',
];

const PRIVACY_SECTIONS = [
  'What we collect (account, business/POS data you connect, chat interactions with AI features, usage and diagnostic data)',
  'How we use it (provide the service; operate, secure, and improve AI features)',
  'Training preferences and the organization-admin opt-out (Settings → Privacy)',
  'Aggregation and de-identification safeguards',
  'Retention, your rights, and how to contact us',
];

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const isTerms = kind === 'terms';
  const title = isTerms ? 'Terms of Service' : 'Privacy Policy';
  const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  return (
    <div style={s.page}>
      <div style={s.column}>
        <header style={s.header}>
          <a href="/" style={s.brand}>AROS</a>
          <nav style={s.nav}>
            <a href="/legal/terms" style={{ ...s.navLink, fontWeight: isTerms ? 800 : 500 }}>Terms</a>
            <a href="/legal/privacy" style={{ ...s.navLink, fontWeight: isTerms ? 500 : 800 }}>Privacy</a>
          </nav>
        </header>

        <div style={s.draftBanner} role="status">
          <strong>DRAFT — pending attorney review.</strong> This page is a placeholder outline, not
          the final {title}. The final document will be published here after legal review.
        </div>

        <h1 style={s.title}>{title}</h1>
        <p style={s.meta}>Nirlab Inc. · This document is not yet in effect.</p>

        <p style={s.body}>
          The final {title} will cover, at minimum, the following sections:
        </p>
        <ul style={s.list}>
          {sections.map((item) => (
            <li key={item} style={s.listItem}>{item}</li>
          ))}
        </ul>

        <p style={s.body}>
          Questions in the meantime? Reach us via the{' '}
          <a href="/contact" style={s.link}>contact page</a>.
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fc', fontFamily: 'Inter, system-ui, sans-serif', color: '#1a1a2e', padding: '0 16px 64px' },
  column: { maxWidth: 720, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0' },
  brand: { fontWeight: 800, fontSize: 18, letterSpacing: -0.5, color: '#1a1a2e', textDecoration: 'none' },
  nav: { display: 'flex', gap: 18 },
  navLink: { fontSize: 14, color: '#3b5bdb', textDecoration: 'none' },
  draftBanner: {
    background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 10,
    padding: '12px 16px', fontSize: 13.5, lineHeight: 1.6, color: '#78350f', margin: '8px 0 28px',
  },
  title: { fontSize: 30, fontWeight: 800, margin: '0 0 6px' },
  meta: { fontSize: 13, color: '#6b7280', margin: '0 0 24px' },
  body: { fontSize: 14.5, lineHeight: 1.7, color: '#374151', margin: '0 0 14px' },
  list: { margin: '0 0 18px', paddingLeft: 22 },
  listItem: { fontSize: 14.5, lineHeight: 1.9, color: '#374151' },
  link: { color: '#3b5bdb', fontWeight: 600 },
};

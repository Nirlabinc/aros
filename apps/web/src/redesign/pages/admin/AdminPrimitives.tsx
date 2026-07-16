import type { CSSProperties, ReactNode } from 'react';

const s: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 20, maxWidth: 1080, margin: '0 auto', padding: '8px 0 40px' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  eyebrow: { color: 'var(--muted)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' },
  lead: { color: 'var(--muted)', maxWidth: 680, margin: '6px 0 0', lineHeight: 1.55 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 },
  card: { border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', padding: 18 },
  button: { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 9, padding: '9px 13px', cursor: 'pointer', font: 'inherit', fontWeight: 650 },
  state: { border: '1px solid var(--border)', borderRadius: 14, padding: 28, textAlign: 'center', color: 'var(--muted)' },
  row: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid var(--border)' },
  pill: { display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px', fontSize: 12, color: 'var(--muted)' },
};

export function AdminPage({ eyebrow, lead, action, children }: { eyebrow: string; lead: string; action?: ReactNode; children: ReactNode }) {
  return <section style={s.page}><header style={s.header}><div><div style={s.eyebrow}>{eyebrow}</div><p style={s.lead}>{lead}</p></div>{action}</header>{children}</section>;
}
export function Grid({ children }: { children: ReactNode }) { return <div style={s.grid}>{children}</div>; }
export function Card({ title, value, children }: { title: string; value?: ReactNode; children?: ReactNode }) { return <article style={s.card}><div style={{ color: 'var(--muted)', fontSize: 13 }}>{title}</div>{value != null && <strong style={{ display: 'block', fontSize: 25, marginTop: 7 }}>{value}</strong>}{children}</article>; }
export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} style={{ ...s.button, ...props.style }} />; }
export function State({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) { return <div role={retry ? 'alert' : 'status'} style={s.state}><strong style={{ display: 'block', color: 'var(--text)', marginBottom: 6 }}>{title}</strong><span>{detail}</span>{retry && <div style={{ marginTop: 14 }}><Button onClick={retry}>Try again</Button></div>}</div>; }
export function Rows({ children }: { children: ReactNode }) { return <div style={s.card}>{children}</div>; }
export function Row({ mark, title, detail, end }: { mark?: string; title: string; detail: string; end?: ReactNode }) { return <div style={s.row}>{mark && <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--subtle)', display: 'grid', placeItems: 'center', fontWeight: 750 }}>{mark}</span>}<div style={{ flex: 1, minWidth: 0 }}><strong>{title}</strong><div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 3 }}>{detail}</div></div>{end}</div>; }
export function Pill({ children }: { children: ReactNode }) { return <span style={s.pill}>{children}</span>; }
export function Gap({ children }: { children: ReactNode }) { return <div style={{ border: '1px dashed var(--border)', background: 'var(--subtle)', borderRadius: 12, padding: 14, color: 'var(--muted)', fontSize: 13 }}><strong style={{ color: 'var(--text)' }}>API gap</strong><div style={{ marginTop: 3 }}>{children}</div></div>; }
export function Loading() { return <State title="Loading workspace data…" detail="Securely retrieving the latest information." />; }

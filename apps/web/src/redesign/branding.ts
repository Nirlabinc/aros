// Whitelabel surface for the chat-first shell. Every brand-specific string and
// mark lives here (not hardcoded in components), so a reseller build can swap the
// product name, byline, logo mark, and concierge name in one place. The visual
// theme (colors) is whitelabeled separately via the CSS token layer in
// aros-design.css (:root[data-aros-theme] / applyBrandTokens below).
//
// Wire-up: the platform's WhitelabelProvider can feed resolveBranding() at boot
// (name → product, agent.name → concierge, theme.colors → applyBrandTokens).

export interface Branding {
  product: string;        // "AROS"
  byline: string;         // "by ShreAI"
  mark: string;           // single/two-char logo mark, e.g. "A"
  concierge: string;      // the AI persona shown in chat, e.g. "Shre"
  /** Optional token overrides applied at runtime, e.g. { '--accent': '#2563eb' }. */
  tokens?: Record<string, string>;
}

export const DEFAULT_BRANDING: Branding = {
  product: 'AROS',
  byline: 'by ShreAI',
  mark: 'A',
  concierge: 'Shre',
};

let current: Branding = DEFAULT_BRANDING;

/** Overlay partial branding (e.g. from WhitelabelProvider) over the defaults. */
export function resolveBranding(override?: Partial<Branding>): Branding {
  current = { ...DEFAULT_BRANDING, ...(override || {}) };
  if (current.tokens) applyBrandTokens(current.tokens);
  return current;
}

export function branding(): Branding { return current; }

/** Whitelabel theming: set CSS custom properties on :root at runtime. */
export function applyBrandTokens(tokens: Record<string, string>) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
}

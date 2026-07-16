import { useEffect, useState } from 'react';

/**
 * Light/dark control for the AROS chat-first redesign. The choice is written to
 * <html data-aros-theme> (which drives the CSS token overrides) and persisted.
 * With no stored choice the app follows the OS via prefers-color-scheme, so the
 * toggle only pins an explicit override.
 */
export type ArosTheme = 'light' | 'dark';

const STORAGE_KEY = 'aros-theme';

function resolveInitial(): ArosTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useArosTheme() {
  const [theme, setTheme] = useState<ArosTheme>(resolveInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-aros-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const label = theme === 'dark' ? 'Light' : 'Dark';
  return { theme, setTheme, toggle, label };
}

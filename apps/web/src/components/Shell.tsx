/**
 * Shell — the authenticated app frame: Sidebar + routed content + the docked
 * data canvas + the concierge chat. Previously this exact `.aros-app` block was
 * copy-pasted across ~7 route branches in App.tsx; it now lives here once.
 *
 * Canvas focus mode hides the sidebar and main content so the data pane takes
 * the whole content area — the page stays MOUNTED (state preserved), just
 * visually hidden via `display: none`.
 */
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { ArosChat } from '../aros-ai/ArosChat';
import { DataCanvasPanel, useIsDesktop } from '../aros-ai/DataCanvasPanel';
import { useCanvas } from '../aros-ai/CanvasContext';

export function Shell({ children }: { children: ReactNode }) {
  const { open, focus } = useCanvas();
  const isDesktop = useIsDesktop();
  const focused = open && focus && isDesktop;

  return (
    <div className="aros-app">
      {/* display:contents keeps <Sidebar>'s own <aside> as the direct flex
          child when visible; display:none hides it (mounted) when focused. */}
      <div style={{ display: focused ? 'none' : 'contents' }}>
        <Sidebar />
      </div>
      <main className="aros-main" style={focused ? { display: 'none' } : undefined}>
        {children}
      </main>
      <DataCanvasPanel />
      <ArosChat />
    </div>
  );
}

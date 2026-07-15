/**
 * DataCanvasPanel — the concierge's persistent data pane (chat = control
 * plane, canvas = data plane). mib-widget results the agent emits pin here so
 * the latest chart/table/metric stays on screen at full size instead of
 * scrolling away inside the 380px chat. Focus mode hides the app's main
 * content so the data takes the content area (Esc exits).
 *
 * Docked as a flex sibling of `.aros-main` on desktop; a full slide-in overlay
 * on mobile. Single mount via matchMedia → one Escape listener.
 */
import { useEffect, useState } from 'react';
import { useCanvas } from './CanvasContext';
import { useChatTheme } from './chatTheme';
import { WidgetRenderer } from './ChatMessageRenderer';

const DESKTOP_QUERY = '(min-width: 768px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isDesktop;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function iconButton(color: string): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', cursor: 'pointer', color, flexShrink: 0,
  };
}

function CanvasBody({ isDesktop }: { isDesktop: boolean }) {
  const { items, selectedId, setSelectedId, focus, setFocus, setOpen } = useCanvas();
  const c = useChatTheme();
  const selected = items.find((it) => it.id === selectedId) ?? items[items.length - 1];

  const close = () => { setOpen(false); setFocus(false); };

  // Escape: leave focus mode first, then close. Never steals Escape from a
  // focused input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTypingTarget(e.target)) return;
      if (focus && isDesktop) setFocus(false);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, isDesktop]);

  // Focus mode is a desktop concept — drop it when the viewport leaves desktop
  // so a resize back to desktop doesn't silently re-hide the sidebar + page.
  useEffect(() => {
    if (!isDesktop && focus) setFocus(false);
  }, [isDesktop, focus, setFocus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: c.bg1, color: c.text1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: c.bg2, borderBottom: `1px solid ${c.border2}`, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: c.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text1 }}>Data canvas</div>
          <div style={{ fontSize: 10, color: c.text3 }}>{items.length} result{items.length === 1 ? '' : 's'} from this conversation</div>
        </div>
        {isDesktop && (
          <button
            onClick={() => setFocus(!focus)}
            title={focus ? 'Exit focus (Esc)' : 'Focus on data'}
            aria-pressed={focus}
            style={iconButton(c.text2)}
          >
            {focus ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            )}
          </button>
        )}
        <button onClick={close} title="Close canvas" aria-label="Close canvas" style={iconButton(c.text2)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Selected result */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {selected && (
          <div key={selected.id} style={{ background: c.msgAi, border: `1px solid ${c.border2}`, borderRadius: 12, padding: 14 }}>
            <WidgetRenderer block={selected.widget} palette={c} />
          </div>
        )}

        {/* History */}
        {items.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: c.text3, padding: '0 2px 6px' }}>History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.slice().reverse().map((item) => {
                const active = item.id === selected?.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    aria-current={active}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 8, textAlign: 'left',
                      borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer',
                      border: `1px solid ${active ? c.accentSoft : 'transparent'}`,
                      background: active ? c.msgAi : 'transparent',
                      color: active ? c.text1 : c.text2,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{item.title}</span>
                    <span style={{ flexShrink: 0, fontSize: 10, textTransform: 'uppercase', color: c.text3 }}>{item.widget.type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The canvas dock. Single mount: docked column on desktop (flex sibling of
 * `.aros-main`), full-width when focused (App hides Sidebar + main), full
 * overlay on mobile. `canvasFocused` from App drives whether the sibling
 * columns are hidden — this component just claims flex:1 to fill the gap.
 */
export function DataCanvasPanel() {
  const { open, items, focus } = useCanvas();
  const isDesktop = useIsDesktop();
  if (!open || items.length === 0) return null;

  if (isDesktop) {
    const focused = focus;
    return (
      <aside
        aria-label="Data canvas"
        style={{
          flexShrink: focused ? 1 : 0,
          flexGrow: focused ? 1 : 0,
          width: focused ? 'auto' : 'clamp(360px, 34vw, 620px)',
          minWidth: 0,
          borderLeft: focused ? 'none' : '1px solid rgba(128,128,128,0.18)',
          height: '100vh',
          position: 'sticky', top: 0, alignSelf: 'flex-start',
        }}
      >
        <CanvasBody isDesktop />
      </aside>
    );
  }

  // Mobile — full overlay ABOVE the fixed chat (9999) so tapping "Open on
  // canvas" from the chat actually surfaces it; its own X returns to the chat.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
      <CanvasBody isDesktop={false} />
    </div>
  );
}

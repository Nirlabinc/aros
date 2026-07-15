/**
 * CanvasContext — shared state for the concierge's data canvas. ArosChat (the
 * widget source, a fixed-position subtree) publishes items here; DataCanvasPanel
 * (docked in the app shell, a different subtree) consumes them. Kept out of
 * ArosChat's local state precisely because the two live in separate trees.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CanvasWidgetItem } from './canvas';

interface CanvasState {
  items: CanvasWidgetItem[];
  /** Publish the derived item set. An empty set also closes the canvas so
   *  focus mode never hides the app with nothing left to show. */
  setItems: (items: CanvasWidgetItem[]) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  focus: boolean;
  setFocus: (focus: boolean) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

const CanvasContext = createContext<CanvasState | null>(null);

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [items, setItemsState] = useState<CanvasWidgetItem[]>([]);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setItems = useCallback((next: CanvasWidgetItem[]) => {
    setItemsState(next);
    if (next.length === 0) {
      setOpen(false);
      setFocus(false);
    }
  }, []);

  const value = useMemo(
    () => ({ items, setItems, open, setOpen, focus, setFocus, selectedId, setSelectedId }),
    [items, setItems, open, focus, selectedId],
  );

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas(): CanvasState {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('useCanvas must be used within a CanvasProvider');
  return ctx;
}

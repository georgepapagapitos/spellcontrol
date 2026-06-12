/**
 * UX-334 — Shortcut-discoverability registry.
 *
 * Pages / components call `useRegisterShortcuts(title, items)` to contribute
 * a named section of keyboard shortcuts to the app-wide `?` overlay. The
 * registry is a React context; the `ShortcutRegistryProvider` lives in
 * `Layout` so it wraps every page.
 *
 * Sections are ordered: "Global" always first, then page contributions in
 * mount order (the contribution of the deepest page-level component wins when
 * two sections share the same title, but in practice each page uses a unique
 * title so they're additive).
 *
 * Items are intentionally kept as plain data (no JSX). The overlay renders
 * them via `KeyboardShortcutsOverlay`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShortcutItem {
  /** Key combo(s). Each string is one chord, rendered as a <kbd>. */
  keys: string[];
  description: string;
}

export interface ShortcutSection {
  title: string;
  shortcuts: ShortcutItem[];
}

// ── Context ───────────────────────────────────────────────────────────────────

interface RegistryContextValue {
  /** Called by contributors on mount; returns a cleanup (unregister) fn. */
  register: (section: ShortcutSection) => () => void;
  /** Ordered list of currently-registered sections. */
  sections: ShortcutSection[];
  /** Whether the overlay is open. */
  open: boolean;
  /** Toggle the overlay open/closed. */
  toggle: () => void;
  /** Explicitly open. */
  show: () => void;
  /** Explicitly close. */
  hide: () => void;
}

const RegistryContext = createContext<RegistryContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  // Each contributor is stored by a stable Symbol key so order is preserved
  // and unregistering a single section doesn't affect others.
  const registrationsRef = useRef<Map<symbol, ShortcutSection>>(new Map());
  // Force a re-render when the map changes.
  const [sections, setSections] = useState<ShortcutSection[]>([]);
  const [open, setOpen] = useState(false);

  const rebuild = useCallback(() => {
    setSections(Array.from(registrationsRef.current.values()));
  }, []);

  const register = useCallback(
    (section: ShortcutSection) => {
      const id = Symbol(section.title);
      registrationsRef.current.set(id, section);
      rebuild();
      return () => {
        registrationsRef.current.delete(id);
        rebuild();
      };
    },
    [rebuild]
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  return (
    <RegistryContext.Provider value={{ register, sections, open, toggle, show, hide }}>
      {children}
    </RegistryContext.Provider>
  );
}

// ── Consumer hooks ────────────────────────────────────────────────────────────

/**
 * Returns the full registry context. Used by Layout (to render the overlay
 * and wire the `?` global key) and by Footer (to open the overlay on click).
 */
export function useShortcutRegistry(): RegistryContextValue {
  const ctx = useContext(RegistryContext);
  if (!ctx) {
    throw new Error('useShortcutRegistry must be used inside ShortcutRegistryProvider');
  }
  return ctx;
}

/**
 * Register a shortcut section while the calling component is mounted.
 * The section is automatically removed on unmount.
 *
 * Keep `shortcuts` stable (a module-level constant or useMemo) to avoid
 * re-registering on every render — it's in the effect dep array.
 */
export function useRegisterShortcuts(title: string, shortcuts: ShortcutItem[]): void {
  const { register } = useShortcutRegistry();

  useEffect(() => {
    const cleanup = register({ title, shortcuts });
    return cleanup;
  }, [register, title, shortcuts]);
}

// ── Typing-target guard (shared across handlers) ──────────────────────────────

/**
 * Returns true when the event target is a text-entry element (input,
 * textarea, contenteditable). Prevents `?` from firing while the user types.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

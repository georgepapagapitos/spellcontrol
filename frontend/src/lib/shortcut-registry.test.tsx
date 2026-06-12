// @vitest-environment happy-dom
/**
 * UX-334 — shortcut-registry tests.
 *
 * Covers:
 * 1. `?` opens the overlay with Global + page sections.
 * 2. `?` does NOT fire while typing in an input/textarea/contenteditable.
 * 3. Registration/unregistration on mount/unmount.
 * 4. Footer chip renders only on fine-pointer logic (isTypingTarget guard used separately).
 * 5. Deck-editor section appears when registered.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useEffect, useMemo } from 'react';
import {
  ShortcutRegistryProvider,
  useRegisterShortcuts,
  useShortcutRegistry,
  isTypingTarget,
  type ShortcutSection,
} from './shortcut-registry';

// Lightweight stub for KeyboardShortcutsOverlay — avoids pulling in Modal
// and its full transitive dep chain (which OOMs the test worker). The stub
// provides role="dialog" so getByRole('dialog') works, and renders section
// titles + shortcut descriptions so content-based assertions hold.
function KeyboardShortcutsOverlay({
  groups,
  onClose,
}: {
  groups: ShortcutSection[];
  onClose: () => void;
}) {
  return (
    <div role="dialog" aria-label="Keyboard shortcuts">
      {groups.map((g) => (
        <section key={g.title}>
          <h3>{g.title}</h3>
          <ul>
            {g.shortcuts.map((s) => (
              <li key={s.description}>{s.description}</li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Stub matchMedia so Modal's reduced-motion check is deterministic. */
function stubMatchMedia(matches = false) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

// Module-level constants so useRegisterShortcuts gets a stable reference.
// Inline array literals would create a new reference on every render and
// cause the effect to re-register on each re-render → infinite loop.
const GLOBAL_SHORTCUTS = [{ keys: ['?'], description: 'Show keyboard shortcuts' }];

/**
 * A minimal shell that:
 * - wraps children in ShortcutRegistryProvider
 * - registers a "Global" section
 * - wires `?` → overlay toggle
 * - renders the overlay via KeyboardShortcutsOverlay
 */
function TestShell({ children }: { children?: React.ReactNode }) {
  return (
    <ShortcutRegistryProvider>
      <TestShellInner>{children}</TestShellInner>
    </ShortcutRegistryProvider>
  );
}

function TestShellInner({ children }: { children?: React.ReactNode }) {
  useRegisterShortcuts('Global', GLOBAL_SHORTCUTS);
  const { sections, open, toggle, hide } = useShortcutRegistry();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== '?') return;
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <>
      {children}
      {open && (
        <KeyboardShortcutsOverlay
          groups={sections.map((s) => ({ title: s.title, shortcuts: s.shortcuts }))}
          onClose={hide}
        />
      )}
    </>
  );
}

/** A component that registers its own section while mounted. */
function PageWithShortcuts({ title, label }: { title: string; label: string }) {
  // useMemo so the shortcuts array reference is stable across re-renders.
  // An inline array literal would recreate on every render and cause
  // useRegisterShortcuts' effect to re-run → infinite register/unregister loop.
  const shortcuts = useMemo(() => [{ keys: ['/'], description: label }], [label]);
  useRegisterShortcuts(title, shortcuts);
  return <div data-testid="page" />;
}

// ── isTypingTarget (unit) ─────────────────────────────────────────────────────

describe('isTypingTarget', () => {
  it('returns false for a plain div', () => {
    const el = document.createElement('div');
    expect(isTypingTarget(el)).toBe(false);
  });

  it('returns true for INPUT', () => {
    const el = document.createElement('input');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('returns true for TEXTAREA', () => {
    const el = document.createElement('textarea');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('returns true for SELECT', () => {
    const el = document.createElement('select');
    expect(isTypingTarget(el)).toBe(true);
  });

  it('returns true for contentEditable', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isTypingTarget(el)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

// ── overlay open/close ────────────────────────────────────────────────────────

describe('? overlay', () => {
  it('opens when ? is pressed outside an input', () => {
    stubMatchMedia(false);
    render(<TestShell />);

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows Global section in the overlay', () => {
    stubMatchMedia(false);
    render(<TestShell />);

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Show keyboard shortcuts')).toBeTruthy();
  });

  it('does NOT open when ? is pressed while an input is focused', () => {
    stubMatchMedia(false);
    render(
      <TestShell>
        <input data-testid="search" />
      </TestShell>
    );

    const input = screen.getByTestId('search');

    // Simulate event with target = the input
    fireEvent.keyDown(input, { key: '?' });

    // The listener checks e.target so we simulate it properly:
    // dispatch from document with the target set to input
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true });
    Object.defineProperty(event, 'target', { value: input, writable: false });
    document.dispatchEvent(event);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT open when ? is pressed while a textarea is focused', () => {
    stubMatchMedia(false);
    render(
      <TestShell>
        <textarea data-testid="notes" />
      </TestShell>
    );

    const textarea = screen.getByTestId('notes');
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true });
    Object.defineProperty(event, 'target', { value: textarea, writable: false });
    document.dispatchEvent(event);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── registration / unregistration ────────────────────────────────────────────

describe('useRegisterShortcuts', () => {
  it('adds a section that appears in the overlay', () => {
    stubMatchMedia(false);
    render(
      <TestShell>
        <PageWithShortcuts title="Collection" label="Focus search" />
      </TestShell>
    );

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByText('Collection')).toBeTruthy();
    expect(screen.getByText('Focus search')).toBeTruthy();
  });

  it('removes the section when the component unmounts', () => {
    stubMatchMedia(false);

    function Wrapper({ show }: { show: boolean }) {
      return (
        <TestShell>
          {show && <PageWithShortcuts title="Deck editor" label="Open card search" />}
        </TestShell>
      );
    }

    const { rerender } = render(<Wrapper show={true} />);

    // Open overlay while Deck editor is mounted
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByText('Deck editor')).toBeTruthy();

    // Close overlay (toggle off with `?` — avoid Escape which awaits the
    // Modal's exit animation that never fires in happy-dom)
    fireEvent.keyDown(document, { key: '?' });

    // Unmount the page component
    rerender(<Wrapper show={false} />);

    // Open overlay again
    fireEvent.keyDown(document, { key: '?' });
    expect(screen.queryByText('Deck editor')).toBeNull();
  });

  it('shows deck-editor items when registered', () => {
    stubMatchMedia(false);

    const DECK_SHORTCUTS = [
      { keys: ['Cmd/Ctrl', 'Z'], description: 'Undo last edit' },
      { keys: ['/'], description: 'Open card search' },
    ];

    function DeckEditorPage() {
      useRegisterShortcuts('Deck editor', DECK_SHORTCUTS);
      return <div />;
    }

    render(
      <TestShell>
        <DeckEditorPage />
      </TestShell>
    );

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByText('Deck editor')).toBeTruthy();
    expect(screen.getByText('Undo last edit')).toBeTruthy();
    expect(screen.getByText('Open card search')).toBeTruthy();
  });

  it('shows multiple sections when multiple contributors are mounted', () => {
    stubMatchMedia(false);

    render(
      <TestShell>
        <PageWithShortcuts title="Collection" label="Focus search" />
        <PageWithShortcuts title="Deck editor" label="Open card search" />
      </TestShell>
    );

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByText('Collection')).toBeTruthy();
    expect(screen.getByText('Deck editor')).toBeTruthy();
  });
});

// ── footer chip logic ─────────────────────────────────────────────────────────

describe('footer chip', () => {
  /**
   * The chip visibility is CSS-only (`display: none` hidden, shown via
   * `@media (min-width:1024px) and (hover:hover) and (pointer:fine)`).
   * In jsdom/happy-dom we can't exercise media queries, so we test the
   * logic-level: clicking the chip opens the overlay.
   */
  it('opens the overlay on click (logic test)', () => {
    stubMatchMedia(false);

    function ChipTester() {
      const { show, open, hide, sections } = useShortcutRegistry();
      return (
        <>
          <button onClick={show} data-testid="chip">
            ?
          </button>
          {open && (
            <KeyboardShortcutsOverlay
              groups={sections.map((s) => ({ title: s.title, shortcuts: s.shortcuts }))}
              onClose={hide}
            />
          )}
        </>
      );
    }

    render(
      <ShortcutRegistryProvider>
        <ChipTester />
      </ShortcutRegistryProvider>
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('chip'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

// ── useShortcutRegistry outside provider ─────────────────────────────────────

describe('useShortcutRegistry outside provider', () => {
  it('throws a descriptive error', () => {
    // Suppress the React error boundary console noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadConsumer() {
      useShortcutRegistry();
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      'useShortcutRegistry must be used inside ShortcutRegistryProvider'
    );

    spy.mockRestore();
  });
});

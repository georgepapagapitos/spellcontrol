// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '@/components/Modal';
import { type SheetExitOptions, useSheetExit } from './use-sheet-exit';

/**
 * T147: a sheet's Escape belongs to useSheetExit, gated on the overlay stack.
 * Before, every sheet hand-rolled a document listener with no topmost check,
 * so Escape in a menu, picker or confirm dialog opened over a sheet closed the
 * sheet underneath as well.
 */

let reducedMotion = true;
beforeEach(() => {
  reducedMotion = true;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : query === 'all',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => vi.restoreAllMocks());

function Sheet({
  onClose,
  options,
  onDialogClose = () => {},
}: {
  onClose: () => void;
  options?: SheetExitOptions;
  onDialogClose?: () => void;
}) {
  const { onAnimationEnd } = useSheetExit(onClose, 'sheet-fall', options);
  // Opened by a button after the sheet mounts, as in the app: a layer's place
  // in the stack is its mount order.
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div role="dialog" aria-label="sheet" onAnimationEnd={onAnimationEnd}>
      <button type="button" onClick={() => setDialogOpen(true)}>
        open confirm
      </button>
      <input
        aria-label="query"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && e.currentTarget.value) e.preventDefault();
        }}
      />
      {dialogOpen && (
        <Modal
          label="confirm"
          onClose={() => {
            onDialogClose();
            setDialogOpen(false);
          }}
        >
          <button type="button">ok</button>
        </Modal>
      )}
    </div>
  );
}

const escape = (target: Element | Document = document) =>
  fireEvent.keyDown(target, { key: 'Escape' });

describe('useSheetExit owns Escape', () => {
  it('closes the sheet', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the sheet alone while a dialog is open over it, then closes it next', () => {
    const onClose = vi.fn();
    const onDialogClose = vi.fn();
    render(<Sheet onClose={onClose} onDialogClose={onDialogClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'open confirm' }));
    expect(screen.getByRole('dialog', { name: 'confirm' })).toBeTruthy();

    escape();
    expect(onDialogClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'confirm' })).toBeNull();

    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the sheet alone when something inside it already handled the key', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: 'query' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sol' } });
    escape(input);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing with escape: false', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} options={{ escape: false }} />);
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes at once where instantAt matches, instead of waiting on an exit animation', () => {
    reducedMotion = false;
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} options={{ instantAt: 'all' }} />);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for the exit animation when instantAt does not match', () => {
    reducedMotion = false;
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} options={{ instantAt: '(min-width: 1024px)' }} />);
    escape();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(screen.getByRole('dialog', { name: 'sheet' }), {
      animationName: 'sheet-fall',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Files that call useSheetExit and still handle Escape themselves, and why. */
const OWN_ESCAPE: Record<string, string> = {
  'components/CardPreview.tsx':
    'escape: false; a window capture-phase handler that defers to the share dialog and an open ⋮ menu',
  'components/AvatarPickerSheet.tsx':
    "the search input clears its query first and preventDefaults, so the hook's close waits for the next Escape",
};

const SRC = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('sheets do not hand-roll Escape', () => {
  const consumers = walk(SRC)
    .filter((p) => !p.endsWith(`${sep}use-sheet-exit.ts`))
    .filter((p) => readFileSync(p, 'utf8').includes('useSheetExit('));

  it('finds the sheets', () => {
    expect(consumers.length).toBeGreaterThan(30);
  });

  for (const p of consumers) {
    const rel = relative(SRC, p).split(sep).join('/');
    it(`${rel} leaves Escape to useSheetExit`, () => {
      const src = readFileSync(p, 'utf8');
      expect(src, `${rel} imports useEscapeKey`).not.toMatch(/useEscapeKey\(/);
      if (OWN_ESCAPE[rel]) return;
      expect(src, `${rel} handles Escape itself; pass options to useSheetExit instead`).not.toMatch(
        /['"]Escape['"]/
      );
    });
  }

  it('the allowlist has no stale entries', () => {
    for (const rel of Object.keys(OWN_ESCAPE)) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, rel).toContain('useSheetExit(');
      expect(src, rel).toMatch(/['"]Escape['"]/);
    }
  });
});

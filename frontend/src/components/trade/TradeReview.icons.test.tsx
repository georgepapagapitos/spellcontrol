// @vitest-environment happy-dom
/**
 * The "+" in the review's text buttons shares a centered line with its label.
 *
 * It sat above the label because the glyph was passed as a CHILD of Button,
 * which lands it inside the inline `.btn-label` span, on the text baseline.
 * Button's `icon` slot makes it a sibling flex item the row centers. The first
 * two tests pin the rendered structure, the third the rule for the one control
 * that is not a Button, and the last scans the folder so a new one can't
 * reintroduce the child form.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCard } from '@/lib/social/shared-types';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({ useAwaitingFirstPull: () => false }));
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, status: 'authed' }),
}));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel({ cards: [] }),
}));
vi.mock('@/store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('@/store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

import { emptyDraft } from '@/lib/trade/trade-draft';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { TradeReview } from './TradeReview';

const here = dirname(fileURLToPath(import.meta.url));
const props = {
  friendId: 'f1',
  friendName: 'Pal',
  onAddMore: () => {},
  onAddFromYours: () => {},
  onSent: () => {},
  theirCards: [{ name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 's' } as PublicCard],
};

beforeEach(() => {
  useTradeDraftsStore.setState({ drafts: {} });
});

describe('the review centers its text-button icons', () => {
  it('puts the "+" of the empty-side buttons in Button\'s icon slot, not in its label', () => {
    render(<TradeReview {...props} />);
    for (const name of ["Pick from Pal's cards", 'Pick from your cards']) {
      const button = screen.getByRole('button', { name });
      const svg = button.querySelector('svg')!;
      expect(svg.parentElement).toBe(button);
      expect(button.querySelector('.btn-label svg')).toBeNull();
    }
  });

  it('does the same for the "Add more" buttons once there are lines', () => {
    useTradeDraftsStore.getState().setDraft('me', 'f1', {
      ...emptyDraft('f1', 'Pal'),
      get: { 'o-sol': { name: 'Sol Ring', oracleId: 'o-sol', quantity: 1 } },
    });
    render(<TradeReview {...props} />);
    const button = screen.getByRole('button', { name: "Add more of Pal's cards" });
    expect(button.querySelector('svg')!.parentElement).toBe(button);
    expect(button.querySelector('.btn-label svg')).toBeNull();
  });

  it('declares the note toggle as a centered flex row whose glyph is its own item', () => {
    const css = readFileSync(join(here, 'TradeReview.css'), 'utf8');
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    const toggle = rule('.trade-review-note-toggle');
    expect(toggle).toMatch(/display:\s*inline-flex/);
    expect(toggle).toMatch(/align-items:\s*center/);
    expect(rule('.trade-review-note-toggle > svg,\n.trade-review-add > svg')).toMatch(
      /display:\s*block/
    );
  });

  it('top-aligns the line grid and keeps meta segments unbreakable', () => {
    const css = readFileSync(join(here, 'TradeReview.css'), 'utf8');
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('.trade-review-line')).toMatch(/align-items:\s*flex-start/);
    // The clipped-separator pattern: row pulled left by one dot box, container clips.
    expect(rule('.trade-review-meta.is-segments')).toMatch(/overflow:\s*hidden/);
    expect(rule('.trade-review-meta-row')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.trade-review-meta-row')).toMatch(
      /margin-left:\s*calc\(-1 \* var\(--meta-sep\)\)/
    );
    expect(rule('.trade-review-meta-seg::before')).toMatch(/width:\s*var\(--meta-sep\)/);
    // The exact separator: a middle dot, not a mangled escape.
    expect(rule('.trade-review-meta-seg::before')).toContain("content: '·';");
    expect(css).not.toMatch(/meta-seg \+ \.trade-review-meta-seg/);
    // The give line's printing keeps its 44px target without 44px of spacing.
    // z-index keeps the whole 44px box the button: the note below overlaps its edge.
    expect(css).toMatch(
      /\.trade-review-printing \{\s*position: relative;\s*z-index: 1;\s*min-height: 44px;\s*margin-block: -14px;/
    );
    expect(rule('.trade-review-meta-seg')).toMatch(/white-space:\s*nowrap/);
  });

  it('keeps every Button in components/trade from taking an icon as its child', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(here).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))) {
      const lines = readFileSync(join(here, file), 'utf8').split('\n');
      const lucide = new Set(
        [
          ...(lines.join('\n').match(/import \{([^}]*)\} from 'lucide-react'/)?.[1] ?? '').matchAll(
            /\w+/g
          ),
        ].map((m) => m[0])
      );
      lines.forEach((line, i) => {
        const icon = line.trim().match(/^<(\w+)\b/)?.[1];
        if (!icon || !lucide.has(icon)) return;
        // Walk up to the tag this line is a child of.
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trim();
          if (t.startsWith('</') || t.startsWith('/>')) break;
          if (t.startsWith('<Button')) {
            offenders.push(`${file}:${i + 1}`);
            break;
          }
          if (/^<[A-Za-z]/.test(t)) break;
        }
      });
    }
    expect(offenders, 'Pass the glyph as <Button icon={...}> so it is a centred flex item').toEqual(
      []
    );
  });
});

// @vitest-environment happy-dom
// Mobile deck-page fold: at ≤640px the deck toolbar collapses to a single row
// (display controls → one "View" popover, list actions → one kebab) and the
// stat strip leads the surface, so the card list clears the first screen at
// 360×780 instead of sitting under three rows of wrapped chrome.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// Stub the thumbnail network leaf so nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake — same stub as the other DeckDisplay
// test suites).
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function card(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '1',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
  } as unknown as ScryfallCard;
}

function slots(names: string[]): DeckDisplayCard[] {
  return names.map((name, i) => ({ slotId: `slot-${name}-${i}`, card: card(name) }));
}

/** DeckDisplay reads the ≤640px breakpoint through matchMedia at mount. */
function setNarrow(narrow: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: /max-width:\s*640px/.test(query) ? narrow : false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function renderDeck(opts: { narrow: boolean; sideboard?: string[]; considering?: string[] }) {
  setNarrow(opts.narrow);
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="commander"
        cards={slots(['Mainboard Card'])}
        sideboard={slots(opts.sideboard ?? [])}
        considering={slots(opts.considering ?? [])}
      />
    </MemoryRouter>
  );
}

describe('deck toolbar — narrow-viewport fold', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('≤640px: display controls collapse into one "View" popover', () => {
    const { getByRole, queryByRole } = renderDeck({ narrow: true });

    expect(getByRole('button', { name: /View/ })).toBeTruthy();
    // The individually-wrapped controls are gone from the row.
    expect(queryByRole('button', { name: /Show symbol key/ })).toBeNull();
    expect(queryByRole('group', { name: /Deck view mode/ })).toBeNull();
  });

  it('≤640px: list actions collapse into one kebab, no inline Export/Test hand', () => {
    const { getByRole, queryByRole } = renderDeck({ narrow: true });

    expect(getByRole('button', { name: /Deck list actions/ })).toBeTruthy();
    expect(queryByRole('button', { name: /^Export$/ })).toBeNull();
  });

  it('>640px: the controls stay expanded inline (desktop is unchanged)', () => {
    const { getByRole, queryByRole } = renderDeck({ narrow: false });

    expect(getByRole('button', { name: /^Export$/ })).toBeTruthy();
    expect(getByRole('button', { name: /Show symbol key/ })).toBeTruthy();
    expect(queryByRole('button', { name: /Deck list actions/ })).toBeNull();
  });

  it('the out-zone jump chip is suppressed at 0 and restored above it', () => {
    const empty = renderDeck({ narrow: true });
    expect(empty.container.querySelector('.deck-toolbar-outzone-chip')).toBeNull();
    // No empty flex child left holding a gap either.
    expect(empty.container.querySelector('.deck-toolbar-summary')).toBeNull();
    empty.unmount();

    const filled = renderDeck({ narrow: true, sideboard: ['A'] });
    expect(filled.container.querySelector('.deck-toolbar-outzone-chip')).not.toBeNull();
  });

  it('the stat strip leads the surface, ahead of the toolbar', () => {
    const { container } = renderDeck({ narrow: true });
    const strip = container.querySelector('.deck-stat-strip')!;
    const toolbar = container.querySelector('.deck-toolbar')!;
    expect(strip).not.toBeNull();
    expect(toolbar).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING === 4: the toolbar comes after the strip.
    expect(strip.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// @vitest-environment happy-dom
// Mobile deck-page fold: at ≤640px the deck toolbar collapses to a single row
// (display controls → one "View" popover, list actions → one kebab) and the
// stat strip leads the surface, so the card list clears the first screen at
// 360×780 instead of sitting under three rows of wrapped chrome.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClipboardPaste, FileText } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// Stub the thumbnail network leaf so nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake — same stub as the other DeckDisplay
// test suites).
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

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

function renderDeck(opts: {
  narrow: boolean;
  sideboard?: string[];
  considering?: string[];
  /** The owner's editor: list edits for the Edit menu, deck actions in the header. */
  owner?: boolean;
}) {
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
        onShowTestHand={() => {}}
        {...(opts.owner && {
          onBulkRemove: () => {},
          deckActionsInHeader: true,
          editActions: [
            { label: 'Paste cards', icon: ClipboardPaste, onClick: () => {} },
            { label: 'Bulk edit', icon: FileText, onClick: () => {} },
          ],
        })}
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

  // STYLE_GUIDE § Layout system: the row never wraps. Search, sort, group,
  // layout and Select sit inline; the row details and the symbol key are in
  // its named View button, a shared deck's Test hand and Export in a kebab
  // (never in View), and nothing filled sits in the toolbar.
  it('>640px: one row, with the key in View and the list actions in the kebab', () => {
    const { container, getByRole, queryByRole, getByText } = renderDeck({ narrow: false });

    expect(container.querySelector('.deck-toolbar-controls--row')).toBeTruthy();
    expect(getByRole('group', { name: /Deck view mode/ })).toBeTruthy();
    expect(getByRole('button', { name: /^Group/ })).toBeTruthy();
    expect(queryByRole('button', { name: /^Export$/ })).toBeNull();
    expect(queryByRole('button', { name: /Test hand/ })).toBeNull();
    expect(queryByRole('button', { name: /Show symbol key/ })).toBeNull();
    expect(container.querySelector('.deck-toolbar .btn-primary')).toBeNull();

    const view = getByRole('button', { name: 'View options' });
    expect(view.textContent).toContain('View');
    fireEvent.click(view);
    expect(getByText('Symbol key')).toBeTruthy();
    expect(queryByRole('button', { name: /Export/ })).toBeNull();
    // Group by is on the row, so View doesn't repeat it.
    expect(queryByRole('button', { name: 'Group cards by' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Deck list actions' }));
    expect(getByRole('menuitem', { name: /Export/ })).toBeTruthy();
    expect(getByRole('menuitem', { name: /Test hand/ })).toBeTruthy();
  });

  // The page's three menus are each named for what they act on: the header's
  // Deck menu (the deck), Edit (the list) and View (the display). With the
  // deck actions in the header, the toolbar has no unnamed kebab at all.
  it.each([
    ['>640px', false],
    ['≤640px', true],
  ])('owner, %s: a named Edit menu holds Select and the list edits; no kebab', (_, narrow) => {
    const { getByRole, queryByRole, getAllByRole } = renderDeck({ narrow, owner: true });

    expect(queryByRole('button', { name: 'Deck list actions' })).toBeNull();
    expect(queryByRole('button', { name: /^Select$/ })).toBeNull();

    const edit = getByRole('button', { name: 'Edit the list' });
    expect(edit.textContent).toContain('Edit');
    fireEvent.click(edit);
    expect(getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Select cards',
      'Paste cards',
      'Bulk edit',
    ]);
    expect(queryByRole('menuitem', { name: /Export|Test hand/ })).toBeNull();
  });

  it('>640px but too narrow for the full row: Group by folds into the ⋯', () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('deck-toolbar') ? 640 : 0;
      },
    });
    try {
      const { getByRole, queryByRole } = renderDeck({ narrow: false });
      expect(queryByRole('button', { name: /^Group/ })).toBeNull();
      expect(getByRole('group', { name: /Deck view mode/ })).toBeTruthy();

      fireEvent.click(getByRole('button', { name: 'View options' }));
      expect(getByRole('button', { name: 'Group cards by' })).toBeTruthy();
      expect(queryByRole('button', { name: /Export/ })).toBeNull();
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    }
  });

  it('carries controls and nothing else, at any out-zone count', () => {
    const empty = renderDeck({ narrow: true });
    expect(empty.container.querySelector('.deck-toolbar-summary')).toBeNull();
    empty.unmount();

    // A non-empty out-zone used to grow a left-hand summary column here. The
    // page hero states the count and owns the jump now.
    const filled = renderDeck({ narrow: true, sideboard: ['A'] });
    expect(filled.container.querySelector('.deck-toolbar-outzone-chip')).toBeNull();
    expect(filled.container.querySelector('.deck-toolbar-summary')).toBeNull();
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

  // Desktop: the page hands a slot on its tab row, and the strip renders there
  // (sticky with the tabs) instead of above the toolbar, with its buttons
  // still wired to this component (STYLE_GUIDE § Deck view).
  it('renders the stat strip into the slot the page hands it', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    try {
      setNarrow(false);
      const { container } = render(
        <MemoryRouter>
          <DeckDisplay
            title="Test deck"
            commander={null}
            format="commander"
            cards={slots(['Mainboard Card'])}
            sideboard={[]}
            considering={[]}
            statStripSlot={slot}
          />
        </MemoryRouter>
      );
      expect(container.querySelector('.deck-stat-strip')).toBeNull();
      expect(slot.querySelector('.deck-stat-strip')).not.toBeNull();
      expect(slot.querySelector('button.deck-stat-health')).not.toBeNull();
    } finally {
      slot.remove();
    }
  });
});

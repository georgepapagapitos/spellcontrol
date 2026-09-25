// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard, type DeckDisplayProps } from './DeckDisplay';

// One deck, one number per role. The role chips above the list, the Power
// tab's Roles panel and the deck checks used to read three different counts
// (overlapping chips over mainboard + sideboard + lands, an overlapping
// density line with the commander, and a generation-time snapshot for the
// bars and checks), so a generated Sram deck showed Removal as 11, 10 and 6
// on one page. These cases are the ones that split them.

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/use-tagger-ready', () => ({ useTaggerReady: () => true }));

// Every role each card is tagged with; the first is its main role.
const TAGS: Record<string, string[]> = {
  Cultivate: ['ramp'],
  // Multi-role: main role draw, also tagged removal.
  'Mulldrifter Stand-in': ['cardDraw', 'removal'],
  'Swords to Plowshares': ['removal'],
  // A fetchland carries the tutor tag, which reads as draw.
  'Evolving Wilds': ['cardDraw'],
  // Sideboard only.
  'Path to Exile': ['removal'],
};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  validateCardRole: (card: { name: string }) => TAGS[card.name]?.[0] ?? null,
  getCardRole: (name: string) => TAGS[name]?.[0] ?? null,
  cardMatchesRole: (name: string, role: string) => TAGS[name]?.includes(role) ?? false,
  hasMultipleRoles: (name: string) => (TAGS[name]?.length ?? 0) > 1,
  getAllCardRoles: (name: string) => TAGS[name] ?? [],
  getRampSubtype: () => null,
  getRemovalSubtype: () => null,
  getBoardwipeSubtype: () => null,
  getCardDrawSubtype: () => null,
}));

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line,
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

const slots = (cards: ScryfallCard[]): DeckDisplayCard[] =>
  cards.map((c, i) => ({ slotId: `slot-${c.name}-${i}`, card: c }));

const mainboard = slots([
  card('Cultivate', 'Sorcery'),
  card('Mulldrifter Stand-in', 'Creature — Elemental'),
  card('Swords to Plowshares', 'Instant'),
  card('Evolving Wilds', 'Land'),
]);
const sideboard = slots([card('Path to Exile', 'Instant')]);

function renderDeck(props: Partial<DeckDisplayProps> = {}) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Roles"
        commander={null}
        format="commander"
        cards={mainboard}
        sideboard={sideboard}
        roleTargets={{ ramp: 2, removal: 2, cardDraw: 2, boardwipe: 0 }}
        // A stale generation-time snapshot. The page must not show it once
        // the live count is available.
        roleCounts={{ ramp: 9, removal: 9, cardDraw: 9, boardwipe: 9 }}
        {...props}
      />
    </MemoryRouter>
  );
}

function chipCounts(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chip of container.querySelectorAll('.deck-role-bar-chip')) {
    const count = chip.querySelector('.deck-role-bar-count')?.textContent ?? '';
    out[(chip.textContent ?? '').replace(count, '').trim()] = count;
  }
  return out;
}

describe('DeckDisplay role counts: one number per role', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('chips count the mainboard once per card: no lands, no sideboard, no second role', () => {
    const { container } = renderDeck();
    expect(chipCounts(container)).toEqual({ Ramp: '1', Removal: '1', 'Card advantage': '1' });
  });

  it('the checks read the same live count, not the stored snapshot', () => {
    const { container } = renderDeck();
    const checks = Array.from(container.querySelectorAll('.deck-identity-card-check')).map((li) =>
      Array.from(li.children)
        .map((c) => (c.textContent ?? '').trim())
        .filter(Boolean)
        .join(' ')
    );
    expect(checks).toContain('▾ Ramp count 1 / 2');
    expect(checks).toContain('▾ Removal count 1 / 2');
    expect(checks.join(' | ')).not.toContain('9 /');
  });

  it("the Power tab's Roles panel shows the chips' numbers", () => {
    const { container } = renderDeck({ activeView: 'power' });
    const rows = Array.from(container.querySelectorAll('.deck-roles-row')).map((r) =>
      (r.textContent ?? '').replace(/\s+/g, '')
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Ramp1\/2/),
        expect.stringMatching(/^Removal1\/2/),
        expect.stringMatching(/^Cardadvantage1\/2/),
      ])
    );
    expect(container.textContent).not.toContain('these overlap');
  });

  it('a chip lights exactly the rows it counts', () => {
    const { container } = renderDeck();
    const removalChip = Array.from(container.querySelectorAll('.deck-role-bar-chip')).find((c) =>
      c.textContent?.startsWith('Removal')
    );
    fireEvent.click(removalChip as HTMLElement);
    const deckRows = Array.from(container.querySelectorAll('.deck-display-main .deck-row')).filter(
      (r) => !r.closest('.deck-outzone')
    );
    const lit = deckRows
      .filter((r) => !r.classList.contains('is-role-dimmed'))
      .map((r) => r.getAttribute('data-peek-name'));
    // The multi-role card is counted under draw, so it stays dimmed here.
    expect(lit).toEqual(['Swords to Plowshares']);
    // The chip counts the deck, so the lens leaves "Not in the deck" alone:
    // the sideboard's Path to Exile is neither counted nor dimmed.
    const outzone = container.querySelectorAll('.deck-outzone .deck-row.is-role-dimmed');
    expect(outzone).toHaveLength(0);
  });
});

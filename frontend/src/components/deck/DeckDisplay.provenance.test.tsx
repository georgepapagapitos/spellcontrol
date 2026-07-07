// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BuildReport, ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// S2: the mainboard row's existing "why is this here" affordance — the
// EDHREC-inclusion chip's tooltip is extended with a "Why it's here" line
// sourced from the persisted buildReport.cardProvenance, with no new
// always-visible badge and no layout shift for cards with no provenance
// entry (manual adds, decks generated before this shipped).

function creature(over: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'o-1',
    name: 'Test Creature',
    mana_cost: '{2}{G}',
    cmc: 3,
    type_line: 'Creature — Beast',
    color_identity: ['G'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    ...over,
  } as ScryfallCard;
}

function makeBuildReport(cardProvenance: Record<string, string>): BuildReport {
  return {
    targetBracket: 'all',
    estimatedBracket: 2,
    dataSource: 'base',
    builtFromCollection: false,
    cardProvenance,
  };
}

function renderDeck(
  cards: DeckDisplayCard[],
  opts: { cardInclusionMap?: Record<string, number>; buildReport?: BuildReport } = {}
) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        cards={cards}
        cardInclusionMap={opts.cardInclusionMap}
        buildReport={opts.buildReport}
      />
    </MemoryRouter>
  );
}

describe('DeckDisplay per-card pick provenance (S2)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it("appends a Why it's here line to the inclusion chip's tooltip when provenance is recorded", () => {
    const card = creature({ id: 'sf-1', name: 'Test Creature' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      cardInclusionMap: { 'Test Creature': 40 },
      buildReport: makeBuildReport({ 'Test Creature': 'EDHREC staple for this commander' }),
    });

    const chip = container.querySelector('.deck-row-inclusion');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('40%');
    const title = chip!.getAttribute('title') ?? '';
    expect(title).toContain('40% of EDHREC decks');
    expect(title).toContain("Why it's here: EDHREC staple for this commander");
  });

  it('renders the inclusion tooltip exactly as before when the card has no provenance entry', () => {
    const card = creature({ id: 'sf-2', name: 'Unrecorded Card' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      cardInclusionMap: { 'Unrecorded Card': 15 },
      buildReport: makeBuildReport({ 'Some Other Card': 'You required this card' }),
    });

    const chip = container.querySelector('.deck-row-inclusion');
    expect(chip).not.toBeNull();
    const title = chip!.getAttribute('title') ?? '';
    expect(title).toBe('15% of EDHREC decks with this commander run this card');
    expect(title).not.toContain("Why it's here");
  });

  it('renders the inclusion tooltip exactly as before when there is no buildReport at all (manual/older deck)', () => {
    const card = creature({ id: 'sf-3', name: 'Manual Add' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      cardInclusionMap: { 'Manual Add': 22 },
    });

    const chip = container.querySelector('.deck-row-inclusion');
    expect(chip).not.toBeNull();
    const title = chip!.getAttribute('title') ?? '';
    expect(title).toBe('22% of EDHREC decks with this commander run this card');
    expect(title).not.toContain("Why it's here");
  });

  it("appends the Why it's here line to the Off-meta chip's tooltip too", () => {
    const card = creature({ id: 'sf-4', name: 'Off Meta Fill' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      cardInclusionMap: { 'Off Meta Fill': 0 },
      buildReport: makeBuildReport({
        'Off Meta Fill': 'Added from a Scryfall search — the EDHREC pool ran short for this slot',
      }),
    });

    const chip = container.querySelector('.deck-row-inclusion.is-offmeta');
    expect(chip).not.toBeNull();
    const title = chip!.getAttribute('title') ?? '';
    expect(title).toContain("Why it's here: Added from a Scryfall search");
  });
});

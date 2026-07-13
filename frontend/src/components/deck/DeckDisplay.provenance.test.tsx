// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

// Inclusion % is measured relative to the commander, so the concept doesn't
// apply to the command zone itself: the commander must never wear an
// "Off-meta" chip (its name is never a key in its own inclusion map).
describe('DeckDisplay commander inclusion chip', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('never renders an inclusion/Off-meta chip on the commander row', () => {
    const commander = creature({
      id: 'cmd-1',
      oracle_id: 'cmd-o-1',
      name: 'Test Commander',
      type_line: 'Legendary Creature — Human',
    });
    const card = creature({ id: 'sf-20', name: 'Staple Pick' });

    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={commander}
          cards={[{ slotId: 'slot-1', card }]}
          cardInclusionMap={{ 'Staple Pick': 40 }}
        />
      </MemoryRouter>
    );

    const chips = container.querySelectorAll('.deck-row-inclusion');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('40%');
    expect(container.querySelector('.deck-row-inclusion.is-offmeta')).toBeNull();
  });
});

// E120: alt-generator modes (oracle-role/art-theme/historical/PDH — Scryfall-
// driven, no EDHREC data) can record a provenance reason for a card that has
// neither a synergy pill (no commander ability profile match) nor an
// inclusion chip (no cardInclusionMap at all), leaving S2's reason with
// nowhere to surface. This third affordance — a quiet InfoTip trigger — fills
// exactly that gap and stays silent everywhere the two existing tooltips
// already cover it.
describe('DeckDisplay third "why it\'s here" affordance (E120)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('renders when provenance is recorded and neither the synergy pill nor the inclusion chip apply', () => {
    const card = creature({ id: 'sf-10', name: 'Scryfall Fill' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      buildReport: makeBuildReport({ 'Scryfall Fill': 'Matches your art/theme search' }),
    });

    expect(container.querySelector('.deck-row-synergy')).toBeNull();
    expect(container.querySelector('.deck-row-inclusion')).toBeNull();
    const trigger = container.querySelector('.deck-row-provenance-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe('Why Scryfall Fill is in this deck');
  });

  it('surfaces the recorded reason in the tooltip on focus (keyboard-reachable)', () => {
    const card = creature({ id: 'sf-11', name: 'Scryfall Fill 2' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      buildReport: makeBuildReport({ 'Scryfall Fill 2': 'Matches your art/theme search' }),
    });

    const trigger = container.querySelector('.deck-row-provenance-trigger') as HTMLButtonElement;
    fireEvent.focus(trigger);
    const bubble = document.body.querySelector('.info-tip-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toBe("Why it's here: Matches your art/theme search");
  });

  it('does not render when the inclusion chip is present', () => {
    const card = creature({ id: 'sf-12', name: 'EDHREC Pick' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }], {
      cardInclusionMap: { 'EDHREC Pick': 40 },
      buildReport: makeBuildReport({ 'EDHREC Pick': 'EDHREC staple for this commander' }),
    });

    expect(container.querySelector('.deck-row-inclusion')).not.toBeNull();
    expect(container.querySelector('.deck-row-provenance')).toBeNull();
  });

  it('does not render when there is no provenance recorded at all', () => {
    const card = creature({ id: 'sf-13', name: 'No Provenance' });
    const { container } = renderDeck([{ slotId: 'slot-1', card }]);

    expect(container.querySelector('.deck-row-provenance')).toBeNull();
  });

  it('does not render when the synergy pill is present (commander ability profile match)', () => {
    const commander = creature({
      id: 'cmd-1',
      oracle_id: 'cmd-o-1',
      name: 'Test Commander',
      type_line: 'Legendary Creature — Human',
      oracle_text: 'Whenever a creature you control enters the battlefield, draw a card.',
    });
    const card = creature({
      id: 'sf-14',
      name: 'ETB Synergy Card',
      oracle_text: 'When this creature enters the battlefield, create a 1/1 token.',
    });

    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={commander}
          cards={[{ slotId: 'slot-1', card }]}
          buildReport={makeBuildReport({ 'ETB Synergy Card': 'Auto-included staple mana rock' })}
        />
      </MemoryRouter>
    );

    expect(container.querySelector('.deck-row-synergy')).not.toBeNull();
    expect(container.querySelector('.deck-row-provenance')).toBeNull();
  });
});

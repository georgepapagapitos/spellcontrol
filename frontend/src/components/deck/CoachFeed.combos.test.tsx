// @vitest-environment happy-dom
//
// Guard (E626, E624): a card that is both a winning combo completion and
// another lane's add (Priest of Titania: a Ramp gap AND the last piece of
// Staff of Domination, which wins through Lathril) showed once, as the ramp
// stand-in, so the Combos filter lost the four most-played Staff partners.
// The oracle text is the real Scryfall text; the deck's payoffs are read from it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { deckComboPayoffs } from '@/deck-builder/services/winConditions/comboPayoffs';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import { winningCombos } from '@/lib/coach/coach-changes';
import type { ComboMatch } from '@/types/combos';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({ useCardCarousel: () => ({ open: vi.fn(), preview: null }) }));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));
vi.mock('./UpgradePlanSheet', () => ({ UpgradePlanSheet: () => null }));

const real = (name: string, type_line: string, oracle_text: string) =>
  ({ name, type_line, oracle_text, keywords: [] }) as unknown as ScryfallCard;

const LATHRIL = real(
  'Lathril, Blade of the Elves',
  'Legendary Creature — Elf Noble',
  'Menace\nWhenever Lathril, Blade of the Elves deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.'
);
const STAFF = real(
  'Staff of Domination',
  'Artifact',
  '{1}: Untap Staff of Domination.\n{2}, {T}: You gain 1 life.\n{3}, {T}: Untap target creature.\n{4}, {T}: Tap target creature.\n{5}, {T}: Draw a card.'
);

beforeAll(() => {
  setCardFactsSnapshot(
    JSON.parse(readFileSync(join(__dirname, '../../../public/card-facts.json'), 'utf8'))
  );
});
afterAll(() => setCardFactsSnapshot(null));

const priestGap = {
  name: 'Priest of Titania',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 90,
} as GapAnalysisCard;
const cultivate = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;

const staffPriest = {
  combo: {
    id: 'staff-priest',
    identity: 'G',
    produces: [
      'Infinite untap of creatures you control',
      'Infinite mana',
      'Infinite card draw',
      'Infinite lifegain',
    ],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 2000,
    cardCount: 2,
    bracket: null,
    cards: [
      { oracleId: 'staff', cardName: 'Staff of Domination', quantity: 1 },
      { oracleId: 'priest', cardName: 'Priest of Titania', quantity: 1 },
    ],
  },
  presentOracleIds: ['staff'],
  missingOracleIds: ['priest'],
} as unknown as ComboMatch;

function props(withCombo: boolean): CoachFeedProps {
  const payoffs = deckComboPayoffs([LATHRIL, STAFF]);
  return {
    gaps: [priestGap, cultivate],
    optimize: undefined,
    synergy: [],
    substitutes: [],
    costPlan: undefined,
    bracketFit: undefined,
    oneAwayCombos: withCombo ? winningCombos({ oneAway: [staffPriest] }, payoffs) : [],
    planScore: undefined,
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: () => undefined,
    ownedNames: new Set(),
    deckNames: new Set(['staff of domination']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
  };
}

const rowNames = () =>
  Array.from(document.querySelectorAll('.coach-feed-rows > li')).map(
    (li) => /Priest of Titania|Cultivate/.exec(li.textContent ?? '')?.[0]
  );

describe('CoachFeed: a winning combo completion that is also another lane add', () => {
  it('lists Priest of Titania in the Combos filter with the combo reason', () => {
    render(<CoachFeed {...props(true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Combos/ }));
    expect(screen.getByText('Priest of Titania')).toBeTruthy();
    expect(screen.getByText(/Completes Staff of Domination/)).toBeTruthy();
  });

  it('shows the card once, at the slot the ramp row earned', () => {
    const { unmount } = render(<CoachFeed {...props(false)} />);
    const before = rowNames();
    unmount();
    render(<CoachFeed {...props(true)} />);
    expect(rowNames()).toEqual(before);
    expect(screen.getAllByText('Priest of Titania')).toHaveLength(1);
  });
});

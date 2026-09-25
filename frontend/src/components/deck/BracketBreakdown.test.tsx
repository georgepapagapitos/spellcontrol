// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { ScryfallCard } from '@/deck-builder/types';
import { BracketBreakdown } from './BracketBreakdown';

function makeEstimation(overrides: Partial<BracketEstimation> = {}): BracketEstimation {
  return {
    bracket: 4,
    label: 'Optimized',
    softScore: 78,
    hardFloors: [
      {
        bracket: 3,
        reason: '2 Game Changer cards',
        detail: 'These cards can take over a game on their own.',
      },
      {
        bracket: 4,
        reason: 'Mass land denial (Armageddon)',
        detail: 'Destroying all lands prevents opponents from playing.',
      },
      {
        bracket: 3,
        reason: '1 late-game combo',
      },
    ],
    breakdown: {
      gameChangerCount: 2,
      gameChangerNames: ['Cyclonic Rift', 'Smothering Tithe'],
      massLandDenialCount: 1,
      massLandDenialNames: ['Armageddon'],
      extraTurnCount: 0,
      extraTurnNames: [],
      twoCardComboCount: 1,
      multiCardComboCount: 0,
      fastManaCount: 3,
      fastManaNames: ['Mana Crypt', 'Mana Vault', 'Chrome Mox'],
      tutorCount: 2,
      tutorNames: ['Demonic Tutor', 'Vampiric Tutor'],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 2.8,
      interactionCount: 11,
    },
    ...overrides,
  };
}

describe('BracketBreakdown', () => {
  it('lists the hard floors as rows and keeps the power-signal working as a table', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // The floors sit under a "Settled" heading: what the rules fix.
    expect(screen.getByRole('heading', { name: /Settled\s*Bracket 4/ })).toBeTruthy();
    expect(screen.getByText('Power signal')).toBeTruthy();

    // Hard floors are a list of rows, one per floor, not a two-column table.
    const floors = screen.getByRole('list', { name: 'Hard floors' });
    expect(floors.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(screen.queryByRole('table', { name: 'Hard floors' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Floor' })).toBeNull();

    // The working behind the score is still a labeled table.
    expect(screen.getByRole('table', { name: 'Power signal' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Detail' })).toBeTruthy();
  });

  it('shows the power signal on its 0 to 100 scale with the next threshold ticked', () => {
    const { container } = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 3,
          label: 'Upgraded',
          softScore: 51,
          hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
        })}
      />
    );
    const meter = container.querySelector('.bracket-breakdown-signal-meter');
    expect(meter).toBeTruthy();
    expect((meter?.querySelector('.meterbar-fill') as HTMLElement).style.width).toBe('51%');
    expect((meter?.querySelector('.meterbar-tick') as HTMLElement).style.left).toBe('66%');
  });

  it('draws the cards that set a floor as their art, falling back to the name', () => {
    const card = (name: string, art?: string) =>
      ({ name, image_uris: art ? { art_crop: art } : undefined }) as unknown as ScryfallCard;
    const deckCardsByName = new Map([
      ['Cyclonic Rift', card('Cyclonic Rift', 'https://cards.scryfall.io/art_crop/rift.jpg')],
      ['Smothering Tithe', card('Smothering Tithe')],
    ]);
    const { container } = render(
      <BracketBreakdown estimation={makeEstimation()} deckCardsByName={deckCardsByName} />
    );
    const rift = screen.getByRole('button', { name: 'Preview Cyclonic Rift' });
    expect(rift.querySelector('img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/art_crop/rift.jpg'
    );
    const tithe = screen.getByRole('button', { name: 'Preview Smothering Tithe' });
    expect(tithe.querySelector('img')).toBeNull();
    expect(tithe.querySelector('.bracket-breakdown-art-img--none')).toBeTruthy();
    expect(container.querySelectorAll('.bracket-breakdown-art-name')).not.toHaveLength(0);
  });

  it('renders a soft-score total row', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    expect(screen.getByText('Total')).toBeTruthy();
    // Total value 78/100 also appears in the summary line, so allow multiple.
    expect(screen.getAllByText('78/100').length).toBeGreaterThan(0);
  });

  it('renders hard floor reasons and contributing card chips', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // Floor reasons
    expect(screen.getByText('2 Game Changer cards')).toBeTruthy();
    expect(screen.getByText('Mass land denial (Armageddon)')).toBeTruthy();
    expect(screen.getByText('1 late-game combo')).toBeTruthy();

    // Floor tags
    expect(screen.getAllByText('Bracket 3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bracket 4').length).toBeGreaterThan(0);

    // Contributing card chips for game-changer + land-denial floors
    expect(screen.getByText('Cyclonic Rift')).toBeTruthy();
    expect(screen.getByText('Smothering Tithe')).toBeTruthy();
    expect(screen.getByText('Armageddon')).toBeTruthy();

    // Combo floor surfaces a count note
    expect(screen.getByText(/1 two-card combo detected/)).toBeTruthy();
  });

  it('renders soft-score components with contributing names', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // '78/100' appears in both the soft-score total and the summary line.
    expect(screen.getAllByText('78/100').length).toBeGreaterThan(0);
    expect(screen.getByText('Fast mana')).toBeTruthy();
    expect(screen.getByText('Tutors')).toBeTruthy();
    expect(screen.getByText('Low curve')).toBeTruthy();
    expect(screen.getByText('Interaction')).toBeTruthy();

    // Fast mana + tutor chips
    expect(screen.getByText('Mana Crypt')).toBeTruthy();
    expect(screen.getByText('Demonic Tutor')).toBeTruthy();

    // Fast mana points: 3 × 8 = 24 / 40
    expect(screen.getByText('24/40')).toBeTruthy();
    // Tutor points: 2 × 5 = 10 / 25
    expect(screen.getByText('10/25')).toBeTruthy();

    // Avg mana value detail
    expect(screen.getByText(/Avg mana value 2\.80/)).toBeTruthy();
  });

  it('renders the calculation summary line (UX-315: power signal language)', () => {
    const { container } = render(<BracketBreakdown estimation={makeEstimation()} />);

    // The summary is split across <strong> nodes, so assert on the
    // normalized textContent of the line element.
    const line = container.querySelector('.bracket-breakdown-summary-line');
    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Floor Bracket 4 + power signal 78/100 → Bracket 4 · Optimized'
    );
  });

  it('notes when a high soft score elevated the bracket above its floor', () => {
    const est = makeEstimation({
      bracket: 4,
      label: 'Optimized',
      softScore: 70,
      hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
    });
    render(<BracketBreakdown estimation={est} />);

    expect(screen.getByText(/bumped the floor from Bracket 3 up to Bracket 4/)).toBeTruthy();
  });

  it('shows the no-floor message when there are no hard floors', () => {
    // The estimator's floor with nothing firing is Core (2), never Exhibition;
    // this once read "Floor Bracket 1", which the estimator never produces.
    const est = makeEstimation({
      bracket: 2,
      label: 'Core',
      softScore: 5,
      hardFloors: [],
    });
    const { container } = render(<BracketBreakdown estimation={est} />);

    expect(
      container.querySelector('.bracket-breakdown-empty')?.textContent?.replace(/\s+/g, ' ')
    ).toBe('No hard floors, so the deck starts at Bracket 2 · Core.');
    const line = container.querySelector('.bracket-breakdown-summary-line');
    // UX-315: summary uses "power signal" language
    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Floor Bracket 2 + power signal 5/100 → Bracket 2 · Core'
    );
  });

  // The Ulamog deck that raised this: three Sensei's Divining Top loops, all
  // Spellbook Exhibition, read as "Infinite combo" elsewhere on the page.
  it('names each loop that sets no floor and scores it as a combo engine', () => {
    const top = "Sensei's Divining Top";
    const est = makeEstimation({
      bracket: 2,
      label: 'Core',
      softScore: 40,
      hardFloors: [],
      breakdown: {
        ...makeEstimation({}).breakdown,
        fastManaCount: 0,
        fastManaNames: [],
        tutorCount: 3,
        tutorNames: [],
        averageCmc: 4.69,
        lowPowerComboCount: 3,
        loopCombos: [
          [top, 'Foundry Inspector', 'Mystic Forge'],
          [top, 'Mystic Forge', 'Ugin, the Ineffable'],
          [top, 'Echoes of Eternity', 'Foundry Inspector'],
        ],
        loopEngineCount: 1,
      },
    });
    const { container } = render(<BracketBreakdown estimation={est} />);
    expect(container.textContent).toContain(
      'These 3 combos set no floor: Commander Spellbook rates them fine at Bracket 2, or they take more than two cards.'
    );
    // E382: the rule limits intentional two-card infinite combos; it never said
    // "only combos that end the game".
    expect(container.textContent).not.toMatch(/only limit two-card combos that end the game/);
    expect(container.querySelectorAll('.bracket-breakdown-loop-list > li')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: `Preview ${top}` })).toHaveLength(3);
    expect(
      screen.getByText('1 engine × 10 pts (3 combos; combos through one card count once)')
    ).toBeTruthy();
  });

  it('names the combo pieces on a combo floor, and notes combos that set no floor', () => {
    const est = makeEstimation({
      bracket: 3,
      label: 'Upgraded',
      softScore: 20,
      hardFloors: [{ bracket: 3, reason: '1 two-card combo' }],
      breakdown: {
        ...makeEstimation({}).breakdown,
        twoCardComboCount: 1,
        comboPieceNames: ['Lightning Runner', 'Aetherwind Basker'],
        lowPowerComboCount: 2,
      },
    });
    const { container } = render(<BracketBreakdown estimation={est} />);
    expect(screen.getByRole('button', { name: 'Preview Lightning Runner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview Aetherwind Basker' })).toBeTruthy();
    expect(screen.queryByText(/two-card combo detected/)).toBeNull();
    expect(container.textContent).toContain('2 more combos are in the deck');
  });
});

// E223 — the breakdown documented the elevation thresholds but never said how
// far off you were. The two rules mirrored here are bracketEstimator.ts's:
// floor >= 4 reaches Bracket 5 at 80, floor < 4 bumps one bracket at 66.
describe('BracketBreakdown — distance to the next threshold', () => {
  function distanceText(container: HTMLElement): string | undefined {
    return container
      .querySelector('.bracket-breakdown-distance')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  }

  it('counts the points to the +1 bracket bump below floor 4', () => {
    const { container } = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 3,
          label: 'Upgraded',
          softScore: 58,
          hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
        })}
      />
    );
    expect(distanceText(container)).toBe(
      '8 more power points (58 → 66) would move this to Bracket 4 · Optimized.'
    );
  });

  it('counts the points to cEDH at floor 4 or above', () => {
    const { container } = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 4,
          softScore: 66,
          hardFloors: [{ bracket: 4, reason: 'Mass land denial (Armageddon)' }],
          // cEDH needs 4+ Game Changers; with them, points are what's left.
          breakdown: { ...makeEstimation({}).breakdown, gameChangerCount: 4 },
        })}
      />
    );
    expect(distanceText(container)).toBe(
      '14 more power points (66 → 80) would move this to Bracket 5 · cEDH.'
    );
  });

  it('says nothing once the deck has already crossed its threshold', () => {
    // Bumped: floor 3 + 70 → bracket 4. No further score-driven move exists.
    const bumped = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 4,
          softScore: 70,
          hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
        })}
      />
    );
    expect(distanceText(bumped.container)).toBeUndefined();
    bumped.unmount();

    // Already cEDH — nothing above it.
    const cedh = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 5,
          label: 'cEDH',
          softScore: 84,
          hardFloors: [{ bracket: 4, reason: 'Mass land denial (Armageddon)' }],
        })}
      />
    );
    expect(distanceText(cedh.container)).toBeUndefined();
  });

  it('says cEDH needs Game Changers instead of promising points will get there', () => {
    const { container } = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 4,
          label: 'Optimized',
          softScore: 88,
          hardFloors: [{ bracket: 4, reason: '1 fast two-card combo' }],
          breakdown: { ...makeEstimation({}).breakdown, gameChangerCount: 2 },
        })}
      />
    );
    expect(distanceText(container)).toBe(
      'cEDH also needs at least 4 Game Changers; this deck runs 2.'
    );
  });

  it('singularizes a one-point gap', () => {
    const { container } = render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 2,
          label: 'Core',
          softScore: 65,
          hardFloors: [],
        })}
      />
    );
    // A no-floor Core deck gets the distance line too (it used to compare
    // against a floor of 1 and drop it).
    expect(distanceText(container)).toContain('1 more power point (65 → 66)');
    expect(distanceText(container)).toContain('Bracket 3');
  });
});

describe('BracketBreakdown before combos are counted', () => {
  it('does not claim "no hard floors" while a combo could still set one', () => {
    const est = makeEstimation({ bracket: 2, label: 'Core', softScore: 5, hardFloors: [] });
    const { container } = render(<BracketBreakdown estimation={est} combosUncounted />);
    expect(
      container.querySelector('.bracket-breakdown-empty')?.textContent?.replace(/\s+/g, ' ')
    ).toBe("No hard floors yet. Combos aren't counted, and a combo can set one.");
  });
});

// Any deck whose Bracket 4 rests on Spellbook's Ruthless rating alone: the
// rule keys on why the floor fired, never on which cards.
function ratingOnly(): BracketEstimation {
  return makeEstimation({
    bracket: 4,
    softScore: 22,
    hardFloors: [
      {
        bracket: 4,
        reason: 'Commander Spellbook rates the Card A + Card B combo Ruthless',
        ruthlessCombos: [['Card A', 'Card B']],
      },
      { bracket: 3, reason: '1 Game Changer card' },
    ],
    breakdown: {
      ...makeEstimation().breakdown,
      gameChangerCount: 1,
      gameChangerNames: ['Rhystic Study'],
      massLandDenialCount: 0,
      massLandDenialNames: [],
      fastManaCount: 1,
      fastManaNames: ['Sol Ring'],
      tutorCount: 0,
      tutorNames: [],
    },
  });
}

describe('BracketBreakdown judgment call', () => {
  it('settles the combo at 3 and argues 3 against 4, with ours marked', () => {
    render(<BracketBreakdown estimation={ratingOnly()} />);
    expect(screen.getByRole('heading', { name: /Settled\s*At least Bracket 3/ })).toBeTruthy();
    expect(screen.getByText('Two-card infinite combos')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Judgment\s*Bracket 3 or 4/ })).toBeTruthy();
    expect(screen.getByText(/rates this combo Ruthless, its rating for combos/)).toBeTruthy();
    expect(
      screen.getByText(
        'The list has no tutors and 1 fast mana card, too few to call the combo fast.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Our call').closest('.bracket-call-side')?.textContent).toMatch(
      /Reads as 4/
    );
  });

  it('says Sol Ring is not counted as fast mana when the deck runs it', () => {
    const cards = new Map([['Sol Ring', {} as ScryfallCard]]);
    render(<BracketBreakdown estimation={ratingOnly()} deckCardsByName={cards} />);
    expect(
      screen.getByText(
        'The list has no tutors and 1 fast mana card besides Sol Ring, too few to call the combo fast.'
      )
    ).toBeTruthy();
  });

  it('has no judgment when the rules settle the bracket', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);
    expect(screen.queryByText('Judgment')).toBeNull();
  });

  it('holds the judgment while combos are uncounted', () => {
    render(<BracketBreakdown estimation={ratingOnly()} combosUncounted />);
    expect(screen.queryByText('Judgment')).toBeNull();
  });

  it('argues a power-signal borderline the same way', () => {
    render(
      <BracketBreakdown
        estimation={makeEstimation({
          bracket: 2,
          softScore: 62,
          hardFloors: [],
          breakdown: { ...ratingOnly().breakdown, gameChangerCount: 0, gameChangerNames: [] },
        })}
      />
    );
    expect(screen.getByRole('heading', { name: /Judgment\s*Bracket 2 or 3/ })).toBeTruthy();
    expect(
      screen.getByText('Power signal 62/100, 4 points under the Bracket 3 line.')
    ).toBeTruthy();
    expect(screen.getByText('Nothing in the list sets a Bracket 3 floor.')).toBeTruthy();
  });

  it("the owner's answer states the deck's Bracket", () => {
    const set = vi.fn();
    render(<BracketBreakdown estimation={ratingOnly()} onSetBracketOverride={set} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bracket 3 · Upgraded' }));
    expect(set).toHaveBeenCalledWith(3);
  });

  it('shows the stated answer as picked', () => {
    render(
      <BracketBreakdown
        estimation={ratingOnly()}
        bracketOverride={3}
        onSetBracketOverride={vi.fn()}
      />
    );
    expect(
      (screen.getByRole('radio', { name: 'Bracket 3 · Upgraded' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText("This deck's Bracket is now 3.")).toBeTruthy();
  });
});

describe('BracketBreakdown pod line', () => {
  it('is for the owner only', () => {
    const { rerender } = render(<BracketBreakdown estimation={ratingOnly()} />);
    expect(screen.queryByText('Tell your pod')).toBeNull();
    rerender(<BracketBreakdown estimation={ratingOnly()} onSetBracketOverride={vi.fn()} />);
    expect(screen.getByText('Tell your pod')).toBeTruthy();
    expect(
      screen.getByText(/^Bracket 4 \(Optimized\), borderline 3\. 1 Game Changer: Rhystic Study\./)
    ).toBeTruthy();
  });
});

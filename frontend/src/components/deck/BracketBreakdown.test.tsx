// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
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
  it('renders two labeled tables: hard floors and power signal (UX-315)', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // Section headers (UX-315: "Soft score" → "Power signal")
    expect(screen.getByText('Hard floors')).toBeTruthy();
    expect(screen.getByText('Power signal')).toBeTruthy();

    // The two tables are present and labeled.
    expect(screen.getByRole('table', { name: 'Hard floors' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Power signal' })).toBeTruthy();

    // Column headers — Floor/Reason for hard floors, Signal/Detail for power signal.
    expect(screen.getByRole('columnheader', { name: 'Floor' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Reason' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Detail' })).toBeTruthy();
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
    expect(screen.getAllByText(/Floor: Bracket 3/).length).toBeGreaterThan(0);
    expect(screen.getByText('Floor: Bracket 4')).toBeTruthy();

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

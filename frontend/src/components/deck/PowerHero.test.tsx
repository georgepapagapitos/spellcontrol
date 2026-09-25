// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PowerHero, type PowerHeroProps } from './PowerHero';

const base: PowerHeroProps = {
  bracket: 3,
  bracketOverridden: false,
  bracketReasons: ['2 game changers', '1 combo', '8 tutors'],
  engineLabel: 'Tokens / go-wide',
  engineProducers: 10,
  enginePayoffs: 8,
  engineLopsided: false,
  comboInDeck: 2,
  comboOneAway: 3,
  comboOwnedMissing: 0,
  combosLoading: false,
};

function renderHero(overrides: Partial<PowerHeroProps> = {}) {
  return render(<PowerHero {...base} {...overrides} />);
}

/** Match by an element's full (whitespace-collapsed) textContent, since the
 *  hero splits copy across many text nodes (e.g. "Balanced engine · 10
 *  enablers, 8 payoffs"). */
function hasText(re: RegExp): boolean {
  return Array.from(document.querySelectorAll('p, span')).some((el) =>
    re.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())
  );
}

describe('PowerHero', () => {
  it('renders the bracket number, label, and floor reasons', () => {
    renderHero();
    expect(hasText(/^Bracket 3 · Upgraded$/)).toBe(true);
    expect(hasText(/^because: 2 game changers, 1 combo, 8 tutors$/)).toBe(true);
  });

  it('caps the floor reasons at three', () => {
    renderHero({ bracketReasons: ['a', 'b', 'c', 'd'] });
    expect(hasText(/^because: a, b, c$/)).toBe(true);
    expect(hasText(/^because:.*\bd\b/)).toBe(false);
  });

  it('drops the "manual" tag and still shows the reasons, labeled as the estimate', () => {
    renderHero({ bracketOverridden: true });
    expect(screen.queryByText('manual')).toBeNull();
    expect(hasText(/^because: 2 game changers, 1 combo, 8 tutors$/)).toBe(true);
  });

  it('shows an Estimate line only when it differs from the stated bracket', () => {
    renderHero({ bracketOverridden: true, bracketEstimate: 4 });
    expect(hasText(/^Estimate: Bracket 4 · Optimized$/)).toBe(true);
  });

  it('omits the Estimate line when the stated bracket matches the estimate', () => {
    renderHero({ bracketOverridden: true, bracketEstimate: 3 });
    expect(hasText(/^Estimate: /)).toBe(false);
  });

  it('renders a borderline marker next to the estimate on Auto', () => {
    renderHero({ bracketBorderline: 4 });
    expect(screen.getByLabelText('Borderline between Bracket 3 and Bracket 4')).toBeTruthy();
    expect(hasText(/Borderline 3\/4/)).toBe(true);
  });

  it('renders a borderline marker next to the Estimate line when overridden and differing', () => {
    renderHero({ bracketOverridden: true, bracketEstimate: 4, bracketBorderline: 5 });
    expect(screen.getByLabelText('Borderline between Bracket 4 and Bracket 5')).toBeTruthy();
  });

  it('renders no borderline marker when bracketBorderline is absent', () => {
    renderHero();
    expect(screen.queryByText(/Borderline/)).toBeNull();
  });

  it('shows "Bracket —" when bracket is null', () => {
    renderHero({ bracket: null });
    expect(hasText(/^Bracket —$/)).toBe(true);
  });

  it('says the first estimate is still coming instead of "Bracket —"', () => {
    renderHero({ bracket: null, bracketPending: true, combosLoading: true });
    expect(screen.getByText('Estimating bracket…')).toBeTruthy();
    expect(hasText(/^Bracket —$/)).toBe(false);
  });

  it('keeps a known bracket on screen while a re-estimate is pending', () => {
    renderHero({ bracketPending: true });
    expect(hasText(/^Bracket 3 · Upgraded$/)).toBe(true);
  });

  it('reads the bracket as a floor while combos are still being checked', () => {
    renderHero({ bracketMissesCombos: true, combosLoading: true });
    expect(hasText(/^At least Bracket 3 · Upgraded$/)).toBe(true);
    expect(screen.getByText('Still checking combos, so it may be higher.')).toBeTruthy();
  });

  it('combos landed but the estimate has not caught up: still a floor, not "unchecked"', () => {
    renderHero({ bracketMissesCombos: true, combosLoading: false });
    expect(hasText(/^At least Bracket 3 · Upgraded$/)).toBe(true);
    expect(screen.getByText('Still checking combos, so it may be higher.')).toBeTruthy();
  });

  it('a bracket that saw the combo check is not a floor while a re-check runs', () => {
    renderHero({ combosLoading: true });
    expect(hasText(/^Bracket 3 · Upgraded$/)).toBe(true);
  });

  it('reads the bracket as a floor when combos could not be checked', () => {
    const onRetryCombos = vi.fn();
    renderHero({ bracketMissesCombos: true, combosError: "Couldn't load combos.", onRetryCombos });
    expect(hasText(/^At least Bracket 3 · Upgraded$/)).toBe(true);
    expect(screen.getByText("Combos weren't checked, so it may be higher.")).toBeTruthy();
    // The combo line must not claim the deck has none.
    expect(hasText(/combos? in deck/)).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load combos.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryCombos).toHaveBeenCalledTimes(1);
  });

  it('a manual bracket is not a floor, even when combos failed', () => {
    renderHero({
      bracketOverridden: true,
      bracketMissesCombos: true,
      combosError: "Couldn't load combos.",
    });
    expect(hasText(/^At least/)).toBe(false);
  });

  it('renders the engine label and a "Balanced engine" verdict with spelled-out counts', () => {
    renderHero();
    expect(screen.getByText('Tokens / go-wide')).toBeTruthy();
    expect(screen.getByText('Balanced engine')).toBeTruthy();
    expect(hasText(/10 enablers, 8 payoffs/)).toBe(true);
    expect(screen.queryByText('Lopsided')).toBeNull();
  });

  it('shows the lopsided verdict when the engine is lopsided', () => {
    renderHero({ engineLopsided: true });
    expect(screen.getByText('Lopsided')).toBeTruthy();
    expect(screen.queryByText('Balanced engine')).toBeNull();
  });

  it('pluralizes a single enabler/payoff', () => {
    renderHero({ engineProducers: 1, enginePayoffs: 1 });
    expect(hasText(/1 enabler, 1 payoff$/)).toBe(true);
  });

  it('shows "No dominant engine yet" when there is no engine', () => {
    renderHero({ engineLabel: undefined });
    expect(screen.getByText('No dominant engine yet')).toBeTruthy();
    expect(screen.queryByText('Tokens / go-wide')).toBeNull();
  });

  it('shows the combo-loading placeholder and hides the counts while loading', () => {
    renderHero({ combosLoading: true });
    expect(screen.getByText('Checking for combos…')).toBeTruthy();
    expect(hasText(/in deck/)).toBe(false);
  });

  // E380/E385: an Ulamog deck with three complete Sensei's Top loops and 17
  // one-away combos, none of whose missing pieces the guest owned, read
  // "3 combos in deck · none you can complete now", as if the three complete
  // combos were the unfinished ones. The second clause names its own bucket.
  it('names the one-card-away bucket when none of it is in the collection', () => {
    renderHero({ comboInDeck: 3, comboOneAway: 17, comboOwnedMissing: 0 });
    expect(hasText(/^3 combos in deck · 17 one card away$/)).toBe(true);
    expect(hasText(/complete now/)).toBe(false);
    expect(screen.queryByText('Checking for combos…')).toBeNull();
  });

  it('says how many more the collection can finish when it owns missing pieces', () => {
    renderHero({ comboOneAway: 5, comboOwnedMissing: 3 });
    expect(hasText(/^2 combos in deck · 3 more you can finish from your collection$/)).toBe(true);
  });

  it('drops "more" when nothing is complete yet', () => {
    renderHero({ comboInDeck: 0, comboOneAway: 4, comboOwnedMissing: 1 });
    expect(hasText(/^No combos in deck · 1 you can finish from your collection$/)).toBe(true);
  });

  it('says only the in-deck count when no combo is one card away', () => {
    renderHero({ comboOneAway: 0, comboOwnedMissing: 0 });
    expect(hasText(/^2 combos in deck$/)).toBe(true);
  });

  it('singularizes a single in-deck combo', () => {
    renderHero({ comboInDeck: 1 });
    expect(hasText(/^1 combo in deck · /)).toBe(true);
  });

  it('never repeats the completable count as a separate collection chip', () => {
    renderHero({ comboOneAway: 2, comboOwnedMissing: 2 });
    expect(hasText(/^2 combos in deck · 2 more you can finish from your collection$/)).toBe(true);
    expect(hasText(/You own the missing piece/)).toBe(false);
  });

  it('renders tappable links that fire navigation callbacks when wired', () => {
    const onViewBracket = vi.fn();
    const onViewEngine = vi.fn();
    const onViewCombos = vi.fn();
    renderHero({ onViewBracket, onViewEngine, onViewCombos });
    fireEvent.click(screen.getByLabelText('View bracket details'));
    fireEvent.click(screen.getByLabelText('View engine details'));
    fireEvent.click(screen.getByLabelText('View combos'));
    expect(onViewBracket).toHaveBeenCalledTimes(1);
    expect(onViewEngine).toHaveBeenCalledTimes(1);
    expect(onViewCombos).toHaveBeenCalledTimes(1);
  });

  it('renders static lines (no link buttons) when navigation callbacks are absent', () => {
    renderHero();
    expect(screen.queryByLabelText('View bracket details')).toBeNull();
    expect(screen.queryByLabelText('View engine details')).toBeNull();
    expect(screen.queryByLabelText('View combos')).toBeNull();
  });
});

describe('PowerHero with a stated bracket and a floor estimate', () => {
  it('says the estimate is a floor and may be higher', () => {
    renderHero({
      bracket: 3,
      bracketOverridden: true,
      bracketEstimate: 2,
      bracketMissesCombos: true,
    });
    expect(hasText(/^Estimate: at least Bracket 2 · Core$/)).toBe(true);
    expect(screen.getByText('Still checking combos, so it may be higher.')).toBeTruthy();
    // The owner's stated bracket is their word, never a floor.
    expect(hasText(/^At least Bracket 3/)).toBe(false);
  });

  it('shows the floor estimate even when it equals the stated bracket', () => {
    renderHero({
      bracket: 3,
      bracketOverridden: true,
      bracketEstimate: 3,
      bracketMissesCombos: true,
    });
    expect(hasText(/^Estimate: at least Bracket 3 · Upgraded$/)).toBe(true);
  });

  it('keeps the plain estimate line when combos were counted', () => {
    renderHero({ bracket: 3, bracketOverridden: true, bracketEstimate: 4 });
    expect(hasText(/^Estimate: Bracket 4 · Optimized/)).toBe(true);
  });
});

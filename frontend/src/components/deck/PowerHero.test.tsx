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

  it('shows "manual" and suppresses the "because" line when overridden', () => {
    renderHero({ bracketOverridden: true });
    expect(screen.getByText('manual')).toBeTruthy();
    expect(hasText(/^because:/)).toBe(false);
  });

  it('shows "Bracket —" when bracket is null', () => {
    renderHero({ bracket: null });
    expect(hasText(/^Bracket —$/)).toBe(true);
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

  it('renders the in-deck count and "none you can complete now" with no owned pieces', () => {
    renderHero();
    expect(hasText(/^2 combos in deck · none you can complete now$/)).toBe(true);
    expect(screen.queryByText('Checking for combos…')).toBeNull();
  });

  it('shows the completable count when the user owns missing pieces', () => {
    renderHero({ comboOwnedMissing: 3 });
    expect(hasText(/^2 combos in deck · 3 you can complete$/)).toBe(true);
  });

  it('singularizes a single in-deck combo', () => {
    renderHero({ comboInDeck: 1 });
    expect(hasText(/^1 combo in deck · /)).toBe(true);
  });

  it('shows the collection chip only when owned-missing > 0 and not loading', () => {
    renderHero({ comboOwnedMissing: 0 });
    expect(hasText(/You own the missing piece/)).toBe(false);

    renderHero({ comboOwnedMissing: 2, combosLoading: true });
    expect(hasText(/You own the missing piece/)).toBe(false);
  });

  it('pluralizes the collection chip', () => {
    const { unmount } = renderHero({ comboOwnedMissing: 1 });
    expect(hasText(/You own the missing piece for 1 combo /)).toBe(true);
    unmount();

    renderHero({ comboOwnedMissing: 2 });
    expect(hasText(/You own the missing piece for 2 combos /)).toBe(true);
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

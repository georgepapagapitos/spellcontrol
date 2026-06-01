// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
 *  hero splits copy across many text nodes (e.g. "10 prod · 8 payoff"). */
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

  it('renders the engine label and producer/payoff counts when balanced', () => {
    renderHero();
    expect(screen.getByText('Tokens / go-wide')).toBeTruthy();
    expect(hasText(/^10 prod · 8 payoff$/)).toBe(true);
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.queryByText('lopsided')).toBeNull();
  });

  it('shows the lopsided warning when the engine is lopsided', () => {
    renderHero({ engineLopsided: true });
    expect(screen.getByText('lopsided')).toBeTruthy();
    expect(screen.queryByText('✓')).toBeNull();
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

  it('renders combo counts when not loading', () => {
    renderHero();
    expect(hasText(/^2 in deck · 3 one away$/)).toBe(true);
    expect(screen.queryByText('Checking for combos…')).toBeNull();
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
});

// @vitest-environment happy-dom
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManaSymbolPad } from './ManaSymbolPad';
import { EMPTY_MANA_COST, manaCostCount, manaCostSummary, type ManaCostFilter } from './mana-cost';

const latest: { current: ManaCostFilter } = { current: EMPTY_MANA_COST };
function Harness({ initial = EMPTY_MANA_COST }: { initial?: ManaCostFilter }) {
  const [v, setV] = useState(initial);
  return (
    <ManaSymbolPad
      value={v}
      onChange={(n) => {
        latest.current = n;
        setV(n);
      }}
    />
  );
}

describe('manaCostSummary', () => {
  it('reads each mode and flag as a sentence', () => {
    expect(manaCostSummary(EMPTY_MANA_COST)).toBe('Any mana cost.');
    expect(manaCostSummary({ counts: { B: 2 }, mode: 'atLeast' })).toBe(
      'Costs with at least two black mana symbols, plus anything else.'
    );
    expect(manaCostSummary({ counts: { B: 1, X: 1 }, mode: 'exactColored' })).toBe(
      'Costs with exactly one black mana symbol and one X as colored symbols, plus any generic.'
    );
    expect(manaCostSummary({ counts: {}, mode: 'atLeast', noColored: true, noCost: true })).toBe(
      'Cards that have no colored symbols and have no mana cost.'
    );
    expect(manaCostSummary({ counts: { W: 1 }, mode: 'atLeast', hybrid: false })).toBe(
      "Costs with at least one white mana symbol, plus anything else. Hybrid symbols don't count."
    );
    expect(manaCostCount({ counts: { B: 2, W: 1 }, mode: 'atLeast', hybrid: false })).toBe(4);
  });
});

describe('ManaSymbolPad', () => {
  it('adds a symbol per tap, with a count badge and the cost in the tray', () => {
    render(<Harness />);
    expect(screen.getByText('Tap symbols above')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add black mana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add black mana, 1 added' }));
    expect(latest.current.counts).toEqual({ B: 2 });
    expect(screen.getByRole('button', { name: 'Add black mana, 2 added' }).textContent).toBe('2');
    expect(document.querySelectorAll('.filter-kit-tray-cost .ms-b')).toHaveLength(2);
    expect(
      screen.getByText('Costs with at least two black mana symbols, plus anything else.')
    ).toBeTruthy();
  });

  it('Clear empties the tray but keeps the mode and shortcuts', () => {
    render(<Harness initial={{ counts: { W: 1 }, mode: 'exactColored', noCost: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(latest.current).toEqual({ counts: {}, mode: 'exactColored', noCost: true });
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('switches mode through radios', () => {
    render(<Harness />);
    expect(
      (screen.getByRole('radio', { name: 'At least these' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these colored' }));
    expect(latest.current.mode).toBe('exactColored');
  });

  it('maps the shortcut chips onto the engine query', () => {
    render(<Harness />);
    const chip = (name: string) => screen.getByRole('button', { name });
    // Count hybrid is on by default; the rest are off.
    expect(chip('Count hybrid').getAttribute('aria-pressed')).toBe('true');
    for (const label of ['Has X', 'Phyrexian', 'No colored symbols', 'No mana cost']) {
      expect(chip(label).getAttribute('aria-pressed')).toBe('false');
    }
    fireEvent.click(chip('Has X'));
    expect(latest.current.counts).toEqual({ X: 1 });
    fireEvent.click(chip('Phyrexian'));
    expect(latest.current.counts).toEqual({ X: 1, P: 1 });
    fireEvent.click(chip('Has X'));
    expect(latest.current.counts).toEqual({ P: 1 });
    fireEvent.click(chip('No colored symbols'));
    fireEvent.click(chip('No mana cost'));
    expect(latest.current.noColored).toBe(true);
    expect(latest.current.noCost).toBe(true);
    fireEvent.click(chip('No mana cost'));
    expect('noCost' in latest.current).toBe(false);
    fireEvent.click(chip('Count hybrid'));
    expect(latest.current.hybrid).toBe(false);
    expect(chip('Count hybrid').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip('Count hybrid'));
    expect('hybrid' in latest.current).toBe(false);
  });
});

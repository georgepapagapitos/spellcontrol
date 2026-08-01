// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComboBadge } from './ComboBadge';
import type { ComboMatch, ComboSummary } from '@/types/combos';

function makeCombo(id: string, cards: Array<{ oracleId: string; cardName: string }>): ComboSummary {
  return {
    id,
    identity: 'ub',
    produces: ['Infinite mana'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 10,
    cardCount: cards.length,
    bracket: null,
    cards: cards.map((c) => ({ ...c, quantity: 1 })),
  };
}

function makeMatch(id: string, cards: Array<{ oracleId: string; cardName: string }>): ComboMatch {
  return {
    combo: makeCombo(id, cards),
    presentOracleIds: cards.map((c) => c.oracleId),
    missingOracleIds: [],
  };
}

describe('ComboBadge', () => {
  it('renders nothing for a card with no combos', () => {
    const { container } = render(<ComboBadge oracleId="a" matches={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for an empty combo list', () => {
    const { container } = render(<ComboBadge oracleId="a" matches={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "CB" for a single combo, with the count in the accessible name', () => {
    const match = makeMatch('c1', [
      { oracleId: 'a', cardName: 'Thassa' },
      { oracleId: 'b', cardName: 'Ballista' },
    ]);
    render(<ComboBadge oracleId="a" matches={[match]} />);
    expect(screen.getByText('CB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In 1 combo' })).toBeTruthy();
  });

  it('shows "CB2" and the count for multiple combos, with the count in the accessible name', () => {
    const matches = [
      makeMatch('c1', [
        { oracleId: 'a', cardName: 'Thassa' },
        { oracleId: 'b', cardName: 'Ballista' },
      ]),
      makeMatch('c2', [
        { oracleId: 'a', cardName: 'Thassa' },
        { oracleId: 'c', cardName: 'Kiki-Jiki' },
      ]),
    ];
    render(<ComboBadge oracleId="a" matches={matches} />);
    expect(screen.getByText('CB2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In 2 combos' })).toBeTruthy();
  });

  it('reveals every combo on focus (keyboard) with the current card highlighted', () => {
    const matches = [
      makeMatch('c1', [
        { oracleId: 'a', cardName: 'Thassa' },
        { oracleId: 'b', cardName: 'Ballista' },
      ]),
      makeMatch('c2', [
        { oracleId: 'a', cardName: 'Thassa' },
        { oracleId: 'c', cardName: 'Kiki-Jiki' },
      ]),
    ];
    render(<ComboBadge oracleId="a" matches={matches} />);
    const trigger = screen.getByRole('button', { name: 'In 2 combos' });
    fireEvent.focus(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Ballista');
    expect(tooltip.textContent).toContain('Kiki-Jiki');

    // The current card ("Thassa") is highlighted within each combo's list.
    const highlighted = tooltip.querySelectorAll('.combo-badge-current');
    expect(highlighted.length).toBe(2);
    for (const el of highlighted) expect(el.textContent).toBe('Thassa');
  });

  it('reveals on hover and on touch-focus alike (InfoTip reveal model)', () => {
    const match = makeMatch('c1', [
      { oracleId: 'a', cardName: 'Thassa' },
      { oracleId: 'b', cardName: 'Ballista' },
    ]);
    render(<ComboBadge oracleId="a" matches={[match]} />);
    const trigger = screen.getByRole('button', { name: 'In 1 combo' });

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();

    // Touch devices focus the trigger on tap (no synthetic pointer events
    // needed here — InfoTip's own reveal model is covered by InfoTip.test.tsx;
    // this just confirms ComboBadge wires into the same onFocus/onBlur path).
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriggerReminder, type TriggerCard } from './TriggerReminder';

const arena: TriggerCard = {
  id: 'a',
  name: 'Phyrexian Arena',
  hits: [{ beat: 'beginning', scope: 'own' }],
};
const vortex: TriggerCard = {
  id: 'v',
  name: 'Sulfuric Vortex',
  hits: [{ beat: 'beginning', scope: 'table' }],
};
const rites: TriggerCard = {
  id: 'r',
  name: 'Growing Rites of Itlimoc',
  hits: [{ beat: 'end', scope: 'own' }],
};

function setup(props: Partial<Parameters<typeof TriggerReminder>[0]> = {}) {
  const onLocate = vi.fn();
  const all = {
    cards: [arena, rites],
    beat: null,
    turn: 1,
    myTurn: true,
    onLocate,
    ...props,
  };
  const view = render(<TriggerReminder {...all} />);
  return {
    onLocate,
    rerender: (next: Partial<typeof all>) => view.rerender(<TriggerReminder {...all} {...next} />),
  };
}

describe('TriggerReminder', () => {
  it('stays quiet on mount, however far into the game it mounts', () => {
    setup({ turn: 7 });
    expect(screen.queryByRole('status')).toBe(null);
  });

  it('opens on the next turn and lists each beat with its cards', () => {
    const { rerender } = setup();
    rerender({ turn: 2 });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Upkeep')).toBeTruthy();
    expect(screen.getByText('End step')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phyrexian Arena' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Growing Rites of Itlimoc' })).toBeTruthy();
  });

  it('says nothing when a turn passes with nothing due', () => {
    const { rerender } = setup({ cards: [] });
    rerender({ turn: 2 });
    expect(screen.queryByRole('status')).toBe(null);
  });

  it('does not re-announce an upkeep a take-back walked back to', () => {
    const { rerender } = setup({ turn: 3 });
    rerender({ turn: 2 });
    expect(screen.queryByRole('status')).toBe(null);
  });

  it('shows only the current beat once a phase clock is running', () => {
    const { rerender } = setup({ beat: 'beginning' });
    rerender({ beat: 'end' });
    expect(screen.getByText('End step')).toBeTruthy();
    expect(screen.queryByText('Upkeep')).toBe(null);
    expect(screen.queryByRole('button', { name: 'Phyrexian Arena' })).toBe(null);
  });

  it("holds your own triggers back on an opponent's turn, and keeps the table's", () => {
    const { rerender } = setup({ cards: [arena, vortex], beat: 'beginning', myTurn: true });
    rerender({ myTurn: false });
    expect(screen.getByRole('button', { name: 'Sulfuric Vortex' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Phyrexian Arena' })).toBe(null);
  });

  it('leads from a name to the permanent it names', () => {
    const { rerender, onLocate } = setup();
    rerender({ turn: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Phyrexian Arena' }));
    expect(onLocate).toHaveBeenCalledWith('a');
  });

  it('dismisses on the close button and on Escape', () => {
    const { rerender } = setup();
    rerender({ turn: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss triggers' }));
    expect(screen.queryByRole('status')).toBe(null);

    rerender({ turn: 3 });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBe(null);
  });
});

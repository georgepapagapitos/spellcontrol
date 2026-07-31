// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScrySheet, type ScryResolution } from './ScrySheet';
import type { PlaytestCard } from '@/lib/playtest';

function library(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
}

function renderSheet(cards = library(5)) {
  const onResolve = vi.fn<(r: ScryResolution) => void>();
  render(<ScrySheet library={cards} onClose={() => {}} onResolve={onResolve} />);
  return onResolve;
}

/** The per-card move button, addressed by its aria-label prefix. */
function moveButton(cardName: string) {
  return screen.getByRole('button', { name: new RegExp(`^${cardName}:`) });
}

describe('ScrySheet', () => {
  it('opens on scry looking at one card, all of it kept on top', () => {
    renderSheet();
    expect(screen.getByText('1 card')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Top of library' }).textContent).toContain('Card 0');
    expect(screen.getByRole('button', { name: 'Scry 1' })).toBeTruthy();
  });

  it('steps the peeked window and re-deals the columns', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Look at one more card' }));
    expect(screen.getByText('2 cards')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Top of library' }).textContent).toContain('Card 1');
  });

  it('resolves a scry with the cards moved to the bottom column', () => {
    const onResolve = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Look at one more card' }));
    fireEvent.click(moveButton('Card 0'));
    fireEvent.click(screen.getByRole('button', { name: 'Scry 2' }));
    expect(onResolve).toHaveBeenCalledWith({ mode: 'scry', top: ['c1'], bottom: ['c0'] });
  });

  it('moves a card back to the top column', () => {
    const onResolve = renderSheet();
    fireEvent.click(moveButton('Card 0'));
    fireEvent.click(moveButton('Card 0'));
    fireEvent.click(screen.getByRole('button', { name: 'Scry 1' }));
    expect(onResolve).toHaveBeenCalledWith({ mode: 'scry', top: ['c0'], bottom: [] });
  });

  it('surveil sends the away column to the graveyard, not the bottom', () => {
    const onResolve = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Surveil' }));
    fireEvent.click(moveButton('Card 0'));
    fireEvent.click(screen.getByRole('button', { name: 'Surveil 1' }));
    expect(onResolve).toHaveBeenCalledWith({ mode: 'surveil', top: [], graveyard: ['c0'] });
  });

  it('mill starts with everything already in the graveyard column', () => {
    const onResolve = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Look at one more card' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Mill' }));
    expect(screen.getByRole('list', { name: 'Top of library' }).textContent).toContain(
      'Drop cards here'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mill 2' }));
    expect(onResolve).toHaveBeenCalledWith({ mode: 'mill', top: [], graveyard: ['c0', 'c1'] });
  });

  it("can't look past the end of the library", () => {
    renderSheet(library(2));
    const more = screen.getByRole('button', { name: 'Look at one more card' });
    fireEvent.click(more);
    expect(screen.getByText('2 cards')).toBeTruthy();
    expect(more.hasAttribute('disabled')).toBe(true);
  });
});

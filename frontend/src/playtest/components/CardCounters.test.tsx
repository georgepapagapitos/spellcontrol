// @vitest-environment happy-dom
/**
 * EDHPlay's counters (2026-09-24, from the user's screenshots): a counter on
 * the felt is itself the control. A click adds one, a right-click takes one
 * off, hovering names it, and a "+1" floats up so a click on a small disc
 * visibly landed. Printed counters are icons; named ones are coloured discs.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardCounters } from './CardCounters';

describe('CardCounters', () => {
  it('draws nothing for a card with no counters', () => {
    const { container } = render(<CardCounters counters={{}} placement="edge" />);
    expect(container.firstChild).toBeNull();
  });

  it('adds one on a click and takes one off on a right-click', () => {
    const onStep = vi.fn();
    render(<CardCounters counters={{ charge: 4 }} placement="edge" onStep={onStep} />);
    const charge = screen.getByRole('button', { name: /^Charge: 4/ });
    fireEvent.click(charge);
    expect(onStep).toHaveBeenLastCalledWith('charge', 1);
    const menu = fireEvent.contextMenu(charge);
    expect(onStep).toHaveBeenLastCalledWith('charge', -1);
    // The right-click is the counter's, not the card menu's or the browser's.
    expect(menu).toBe(false);
  });

  it('keeps the minus and plus keys for itself while focused', () => {
    // − also shrinks the cards on the board; a focused counter must not.
    const onStep = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<CardCounters counters={{ 'Counter 1': 2 }} placement="edge" onStep={onStep} />);
    const disc = screen.getByRole('button', { name: /^Counter 1: 2/ });
    fireEvent.keyDown(disc, { key: '-' });
    expect(onStep).toHaveBeenLastCalledWith('Counter 1', -1);
    fireEvent.keyDown(disc, { key: 'ArrowUp' });
    expect(onStep).toHaveBeenLastCalledWith('Counter 1', 1);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('names each counter on hover the way EDHPlay does', () => {
    render(<CardCounters counters={{ charge: 4 }} placement="edge" onStep={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Charge/ }).getAttribute('data-tip')).toBe(
      'Charge (4)'
    );
  });

  it('floats a "+1" up after a click, and clears it', () => {
    vi.useFakeTimers();
    const { container } = render(
      <CardCounters counters={{ '+1/+1': 1 }} placement="edge" onStep={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^\+1\/\+1/ }));
    expect(container.querySelector('.card-counters__burst')?.textContent).toContain('+1');
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('.card-counters__burst')).toBeNull();
    vi.useRealTimers();
  });

  it('splits printed icons from named discs', () => {
    const { container } = render(
      <CardCounters counters={{ ward: 3, custom: 2 }} placement="edge" onStep={vi.fn()} />
    );
    expect(container.querySelector('.card-counters__marks .ms-ability-ward')).toBeTruthy();
    const disc = container.querySelector<HTMLElement>('.card-counters__discs .card-counter--disc');
    expect(disc?.textContent).toBe('2');
    expect(disc?.style.getPropertyValue('--disc')).toMatch(/^#/);
  });

  it('is read-only with no handler: a labelled image, not a button', () => {
    render(<CardCounters counters={{ charge: 1 }} placement="inset" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Charge: 1' })).toBeTruthy();
  });
});

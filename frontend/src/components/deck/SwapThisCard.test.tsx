// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwapThisCard } from './SwapThisCard';
import type { Change } from '@/lib/deck-change';

function alt(name: string, over: Partial<Change> = {}): Change {
  return {
    id: `fill-gaps:${name}`,
    type: 'add',
    lane: 'fill-gaps',
    name,
    reason: 'Ramp staple',
    ...over,
  };
}

describe('SwapThisCard', () => {
  it('renders the heading and a "Swap in" action per alternative', () => {
    render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Kodama’s Reach')]}
        onSwap={vi.fn()}
      />
    );
    expect(screen.getByText('Swap this card')).toBeTruthy();
    expect(screen.getByText('Cultivate')).toBeTruthy();
    expect(screen.getAllByText('Swap in')).toHaveLength(2);
  });

  it('fires onSwap with the chosen alternative name', () => {
    const onSwap = vi.fn();
    const { container } = render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate')]}
        onSwap={onSwap}
      />
    );
    fireEvent.click(container.querySelector('.deck-card-row-act') as HTMLButtonElement);
    expect(onSwap).toHaveBeenCalledWith('Cultivate');
  });

  it('disables every action while a swap is in flight', () => {
    const { container } = render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Kodama’s Reach')]}
        onSwap={vi.fn()}
        swapping
      />
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>('.deck-card-row-act');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b.disabled).toBe(true));
  });

  it('renders nothing when there are no alternatives', () => {
    const { container } = render(
      <SwapThisCard currentName="Sol Ring" alternatives={[]} onSwap={vi.fn()} />
    );
    expect(container.querySelector('.swap-this-card')).toBeNull();
  });
});

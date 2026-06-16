// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwapThisCard } from './SwapThisCard';
import { toSwapAgainst, type Change } from '@/lib/deck-change';

// The page hands SwapThisCard real swap Changes (the focused card → an
// alternative), so each row renders the trade. Build them the same way.
function alt(name: string, currentName = 'Rampant Growth', over: Partial<Change> = {}): Change {
  const incoming: Change = {
    id: `fill-gaps:${name}`,
    type: 'add',
    lane: 'fill-gaps',
    name,
    reason: 'Ramp staple',
    ...over,
  };
  return toSwapAgainst(incoming, currentName);
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

  it('renders the trade as a dual-art swap row (focused card → alternative)', () => {
    const { container } = render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate')]}
        onSwap={vi.fn()}
      />
    );
    // The focused card sits on the left as the dimmed offender being cut.
    expect(container.querySelector('.deck-card-row-swap-art')).toBeTruthy();
    expect(screen.getByLabelText('Rampant Growth art (being cut)')).toBeTruthy();
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

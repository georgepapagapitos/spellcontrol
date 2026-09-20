// @vitest-environment happy-dom
/**
 * E345: power and toughness are read and changed on the card itself, not
 * only through the card menu. The guards here pin the two things that make
 * that safe: what is stored is still a MODIFIER over the printed body (so a
 * typed total lands as the delta that produces it), and a side whose printed
 * value is not a number has no total to type and stays read-only.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { CardPtBadges } from './CardPtBadges';

function card(over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id: 'c1', name: 'Grizzly Bears', power: '2', toughness: '2', ...over };
}

function bf(over: Partial<BattlefieldCard> = {}): BattlefieldCard {
  return {
    card: card(),
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...over,
  };
}

function setup(over: Partial<BattlefieldCard> = {}, c = card()) {
  const onAdjustPT = vi.fn();
  render(<CardPtBadges card={c} bf={bf({ card: c, ...over })} onAdjustPT={onAdjustPT} />);
  return { onAdjustPT };
}

describe('CardPtBadges', () => {
  it('reads the printed body', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Power 2, set it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Toughness 2, set it' })).toBeTruthy();
  });

  it('turns a typed total into the modifier that produces it', () => {
    const { onAdjustPT } = setup({ pt: { power: 1, toughness: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Power 3, set it' }));
    const input = screen.getByLabelText('Power') as HTMLInputElement;
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Printed 2, already +1, asked for 7 → a further +4.
    expect(onAdjustPT).toHaveBeenCalledWith(4, 0);
  });

  it('steps the draft with the arrow keys and commits the toughness side', () => {
    const { onAdjustPT } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Toughness 2, set it' }));
    const input = screen.getByLabelText('Toughness');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdjustPT).toHaveBeenCalledWith(0, 1);
  });

  it('Escape leaves the body alone', () => {
    const { onAdjustPT } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Power 2, set it' }));
    const input = screen.getByLabelText('Power');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onAdjustPT).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Power 2, set it' })).toBeTruthy();
  });

  it('leaves a starred body read-only — there is no total to type', () => {
    const goyf = card({ name: 'Tarmogoyf', power: '*', toughness: '1+*' });
    setup({}, goyf);
    expect(screen.queryByRole('button', { name: /Power/ })).toBeNull();
    expect(screen.getByLabelText('Power *')).toBeTruthy();
  });

  it('shows nothing on a face-down card or one with no body', () => {
    const { container } = render(
      <CardPtBadges card={card()} bf={bf({ faceDown: true })} onAdjustPT={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();

    const ring = card({ name: 'Sol Ring', power: undefined, toughness: undefined });
    const { container: c2 } = render(
      <CardPtBadges card={ring} bf={bf({ card: ring })} onAdjustPT={vi.fn()} />
    );
    expect(c2.firstChild).toBeNull();
  });
});

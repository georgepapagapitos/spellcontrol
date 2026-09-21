// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { PlaytestCardFace } from './PlaytestCardFace';

function card(over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id: 'c1', name: 'Reckless Imp', ...over };
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

/**
 * The counter badges and the body box, which are what a player actually
 * reads a permanent off. Both changed together on purpose: the badge says
 * how many counters are on the card, and the body box says what the card
 * therefore IS — the size and the reason for it, on the same card.
 */
describe('PlaytestCardFace — counters and the body', () => {
  it('shows the size a creature actually is, counters folded in', () => {
    const c = card({ power: '2', toughness: '2' });
    render(<PlaytestCardFace card={c} bf={bf({ card: c, counters: { '+1/+1': 2 } })} />);
    // Read as one body, not two loose numbers.
    expect(screen.getByLabelText('4 by 4')).toBeTruthy();
  });

  it('keeps the counter badge beside it, so the size has a visible reason', () => {
    const c = card({ power: '2', toughness: '2' });
    render(<PlaytestCardFace card={c} bf={bf({ card: c, counters: { '+1/+1': 2 } })} />);
    expect(screen.getByLabelText('2 +1/+1 counters')).toBeTruthy();
  });

  it('says "counter" singular for one', () => {
    render(<PlaytestCardFace card={card()} bf={bf({ counters: { charge: 1 } })} />);
    expect(screen.getByLabelText('1 charge counter')).toBeTruthy();
  });

  // A charge counter on a Sol Ring must not grow it a body it never had.
  it('gives a non-creature with counters a badge but no body box', () => {
    const { container } = render(
      <PlaytestCardFace card={card({ name: 'Sol Ring' })} bf={bf({ counters: { charge: 3 } })} />
    );
    expect(screen.getByLabelText('3 charge counters')).toBeTruthy();
    expect(container.querySelector('.playtest-card__pt')).toBeNull();
  });

  it('rolls extra counter kinds into one overflow badge', () => {
    render(
      <PlaytestCardFace
        card={card()}
        bf={bf({ counters: { '+1/+1': 1, charge: 2, loyalty: 3, stun: 4, shield: 5 } })}
      />
    );
    // Three shown, the rest rolled up and still named in the label.
    expect(screen.getByLabelText(/stun/)).toBeTruthy();
  });

  // Face-down is face-down: a morph's counters would leak that something is
  // being tracked on a card the table cannot see.
  it('shows neither badge nor body on a face-down card', () => {
    const c = card({ power: '2', toughness: '2' });
    const { container } = render(
      <PlaytestCardFace card={c} bf={bf({ card: c, faceDown: true, counters: { '+1/+1': 2 } })} />
    );
    expect(container.querySelector('.playtest-card__counters')).toBeNull();
    expect(container.querySelector('.playtest-card__pt')).toBeNull();
  });

  it('marks a body that differs from what the card prints', () => {
    const c = card({ power: '2', toughness: '2' });
    const { container, rerender } = render(<PlaytestCardFace card={c} bf={bf({ card: c })} />);
    expect(container.querySelector('.playtest-card__pt')?.className).not.toContain('is-modified');
    rerender(<PlaytestCardFace card={c} bf={bf({ card: c, counters: { '+1/+1': 1 } })} />);
    expect(container.querySelector('.playtest-card__pt')?.className).toContain('is-modified');
  });
});

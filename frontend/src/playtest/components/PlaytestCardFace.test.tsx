// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
    expect(screen.getByLabelText('+1/+1: 2')).toBeTruthy();
  });

  // A charge counter on a Sol Ring must not grow it a body it never had.
  it('gives a non-creature with counters a badge but no body box', () => {
    const { container } = render(
      <PlaytestCardFace card={card({ name: 'Sol Ring' })} bf={bf({ counters: { charge: 3 } })} />
    );
    expect(screen.getByLabelText('Charge: 3')).toBeTruthy();
    expect(container.querySelector('.playtest-card__pt')).toBeNull();
  });

  it('draws a printed counter as its icon and a named one as a disc', () => {
    const { container } = render(
      <PlaytestCardFace card={card()} bf={bf({ counters: { charge: 2, 'Counter 1': 1 } })} />
    );
    expect(container.querySelector('.card-counter--mark .ms-counter-charge')).toBeTruthy();
    expect(screen.getByLabelText('Counter 1: 1').querySelector('.card-counter--disc')).toBeTruthy();
  });

  it('leaves them off when the battlefield draws its own beside the card', () => {
    const { container } = render(
      <PlaytestCardFace card={card()} bf={bf({ counters: { charge: 2 } })} countersHidden />
    );
    expect(container.querySelector('.card-counters')).toBeNull();
  });

  // Face-down is face-down: a morph's counters would leak that something is
  // being tracked on a card the table cannot see.
  it('shows neither badge nor body on a face-down card', () => {
    const c = card({ power: '2', toughness: '2' });
    const { container } = render(
      <PlaytestCardFace card={c} bf={bf({ card: c, faceDown: true, counters: { '+1/+1': 2 } })} />
    );
    expect(container.querySelector('.card-counters')).toBeNull();
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

/**
 * A token copy of a printed card is pixel-identical to the card it copied,
 * and the difference decides what survives a bounce — so the face says so.
 */
describe('PlaytestCardFace — the token ribbon', () => {
  it('marks a token', () => {
    render(<PlaytestCardFace card={card({ isToken: true })} bf={bf()} />);
    expect(screen.getByText('Token')).toBeTruthy();
  });

  it('leaves a real card unmarked', () => {
    render(<PlaytestCardFace card={card()} bf={bf()} />);
    expect(screen.queryByText('Token')).toBeNull();
  });

  // The back of a card gives nothing away, the same rule the counters keep.
  it('hides the ribbon while the card is face down', () => {
    render(<PlaytestCardFace card={card({ isToken: true })} bf={bf({ faceDown: true })} />);
    expect(screen.queryByText('Token')).toBeNull();
  });

  // Identity right, state left: a token waiting to resolve wears both, so the
  // two ribbons must never claim the same corner.
  it('takes the corner the stack banner leaves free', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../styles/playtest.css'),
      'utf8'
    );
    const ribbon = /\.playtest-card__token-ribbon\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(ribbon).toContain('right: 0');
    expect(ribbon).not.toContain('left: 0');
  });
});

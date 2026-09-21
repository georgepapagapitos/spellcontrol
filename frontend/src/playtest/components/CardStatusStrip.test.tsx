// @vitest-environment happy-dom
/**
 * Guard: the inspector's board-state strip prints what is true about the
 * permanent right now, and prints nothing at all when nothing is. A card
 * with no counters, no attachment and no tax must not leave an empty chip
 * rail under the type line.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { CardStatusStrip } from './CardStatusStrip';

const card: PlaytestCard = { id: 'c1', name: 'Reckless Imp', power: '2', toughness: '2' };

function bf(o: Partial<BattlefieldCard> = {}): BattlefieldCard {
  return {
    card,
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...o,
  };
}

describe('CardStatusStrip', () => {
  it('renders nothing for an untouched permanent', () => {
    const { container } = render(<CardStatusStrip card={card} bf={bf()} />);
    expect(container.firstChild).toBeNull();
  });

  it('names the states that change what the card can do', () => {
    render(<CardStatusStrip card={card} bf={bf({ tapped: true, phased: true, faceDown: true })} />);
    expect(screen.getByText('Tapped')).toBeTruthy();
    expect(screen.getByText('Phased out')).toBeTruthy();
    expect(screen.getByText('Face down')).toBeTruthy();
  });

  it('tallies counters and prints the body the board actually reads', () => {
    render(
      <CardStatusStrip
        card={card}
        bf={bf({ counters: { '+1/+1': 3, stun: 0 }, pt: { power: 2, toughness: 0 } })}
      />
    );
    expect(screen.getByText('+1/+1 ×3')).toBeTruthy();
    // A counter kind stepped back to zero is not a fact about the card.
    expect(screen.queryByText(/stun/)).toBeNull();
    // 2/2, three +1/+1 counters and a +2/+0 pump. The counters are part of the
    // body (`displayPT`), so the strip must not print the pump alone as 4/2 —
    // that is a size the permanent does not have.
    expect(screen.getByText('Now 7/5')).toBeTruthy();
  });

  it('prints a body changed by counters alone, with no hand-applied pump', () => {
    render(<CardStatusStrip card={card} bf={bf({ counters: { '-1/-1': 1 } })} />);
    expect(screen.getByText('Now 1/1')).toBeTruthy();
  });

  it('points at the host and the tax', () => {
    render(<CardStatusStrip card={card} bf={bf()} attachedToName="Bonesplitter" tax={4} />);
    expect(screen.getByText('Attached to Bonesplitter')).toBeTruthy();
    expect(screen.getByText('Commander tax +4')).toBeTruthy();
  });

  it('carries the player’s own stickers', () => {
    render(<CardStatusStrip card={card} bf={bf({ stickers: ['goes to the face'] })} />);
    expect(screen.getByText('goes to the face')).toBeTruthy();
  });

  it('works for a card inspected from hand, where there is no permanent', () => {
    const { container } = render(<CardStatusStrip card={card} tax={2} />);
    expect(screen.getByText('Commander tax +2')).toBeTruthy();
    expect(container.querySelectorAll('.card-status-chip')).toHaveLength(1);
  });
});

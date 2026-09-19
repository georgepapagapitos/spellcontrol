// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayStore } from '@/store/play';
import { TableArrows } from './TableArrows';

function anchor(attr: string, value: string, rect: Partial<DOMRect>) {
  const el = document.createElement('div');
  el.setAttribute(attr, value);
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      ...rect,
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  usePlayStore.setState({ onlineArrows: [] });
});

describe('TableArrows', () => {
  it('draws nothing with no arrows, and one line per arrow whose ends are on screen', async () => {
    const { container, rerender } = render(<TableArrows mySeat={0} />);
    expect(container.querySelector('svg')).toBeNull();

    anchor('data-preview-id', 'my-card', { left: 10, top: 10 });
    anchor('data-preview-id', 'opp1:their-card', { left: 200, top: 100 });
    anchor('data-seat-anchor', '2', { left: 300, top: 300 });
    usePlayStore.setState({
      onlineArrows: [
        { id: 'a', seat: 0, fromSeat: 0, fromCardId: 'my-card', toSeat: 1, toCardId: 'their-card' },
        // A card nobody renders degrades to the seat's anchor.
        { id: 'b', seat: 1, fromSeat: 1, fromCardId: 'their-card', toSeat: 2, toCardId: 'gone' },
        // An end with nothing on screen hides the arrow.
        { id: 'c', seat: 1, fromSeat: 1, toSeat: 3 },
      ],
    });
    rerender(<TableArrows mySeat={0} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-count')).toBe('2');
    const lines = container.querySelectorAll('.table-arrows__line');
    expect(lines).toHaveLength(2);
    // Your own arrow is marked so it can read a shade brighter.
    expect(container.querySelectorAll('g.is-mine')).toHaveLength(1);
    expect(lines[0].getAttribute('x1')).toBe('15');
  });
});

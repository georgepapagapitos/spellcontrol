import { describe, expect, it } from 'vitest';
import { overflowEdges } from './use-overflow-edges';

function box(scrollWidth: number, clientWidth: number, scrollLeft: number): HTMLElement {
  return { scrollWidth, clientWidth, scrollLeft } as HTMLElement;
}

describe('overflowEdges', () => {
  it('is none when everything fits, allowing a pixel of rounding', () => {
    expect(overflowEdges(box(300, 300, 0))).toBe('none');
    expect(overflowEdges(box(301, 300, 0))).toBe('none');
  });

  it('names the edge with content behind it', () => {
    expect(overflowEdges(box(600, 300, 0))).toBe('end');
    expect(overflowEdges(box(600, 300, 150))).toBe('both');
    expect(overflowEdges(box(600, 300, 300))).toBe('start');
  });
});

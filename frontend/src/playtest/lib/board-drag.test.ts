// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readCardBox } from './board-drag';

describe('readCardBox', () => {
  it("copies the felt's own card box, so the drag copy matches the cards on it", () => {
    // A Horde half redeclares a smaller box than <body>'s: the copy rendered
    // outside the felt must carry the felt's, not inherit the full table's.
    document.body.style.setProperty('--pt-card-w', '110px');
    const felt = document.createElement('div');
    felt.style.setProperty('--pt-card-w', '56px');
    felt.style.setProperty('--pt-card-h', '78.4px');
    felt.style.setProperty('--pt-edge', '11.2px');
    document.body.append(felt);
    expect(readCardBox(felt)).toEqual({
      '--pt-card-w': '56px',
      '--pt-card-h': '78.4px',
      '--pt-edge': '11.2px',
    });
    felt.remove();
    document.body.style.removeProperty('--pt-card-w');
  });

  it('leaves the inherited size before the felt mounts', () => {
    expect(readCardBox(null)).toBeUndefined();
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(readCardBox(bare)).toBeUndefined();
    bare.remove();
  });
});

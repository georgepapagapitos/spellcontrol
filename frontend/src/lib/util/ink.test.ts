import { describe, it, expect } from 'vitest';
import { contrastRatio, inkOn } from './ink';
import { PRESET_COLORS } from './preset-colors';

describe('inkOn', () => {
  it('clears 4.5:1 on every binder preset colour', () => {
    for (const { hex, name } of PRESET_COLORS) {
      const ratio = contrastRatio(hex, inkOn(hex));
      expect(ratio, `${name} ${hex} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears 4.5:1 on any custom colour (a 17-step sweep of the RGB cube)', () => {
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          expect(contrastRatio(hex, inkOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('picks dark ink on gold (the fixed light ink measured 2.4:1) and light ink on purple', () => {
    expect(inkOn('#c89820')).toBe('#000000');
    expect(inkOn('#7060a0')).toBe('#ffffff');
  });

  it('falls back to light ink for a malformed value', () => {
    expect(inkOn('gold')).toBe('#ffffff');
  });
});

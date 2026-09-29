import { describe, expect, it } from 'vitest';
import { classifyInclusion, inclusionColor } from './inclusion-label';

describe('classifyInclusion', () => {
  it('treats 0, undefined, and null identically as no-signal', () => {
    expect(classifyInclusion(0)).toEqual({ kind: 'offmeta', label: 'Off-meta' });
    expect(classifyInclusion(undefined)).toEqual({ kind: 'offmeta', label: 'Off-meta' });
    expect(classifyInclusion(null)).toEqual({ kind: 'offmeta', label: 'Off-meta' });
  });

  it('never reports a real signal below 1%', () => {
    expect(classifyInclusion(0.4)).toEqual({ kind: 'offmeta', label: 'Off-meta' });
  });

  it('reports a rounded real signal', () => {
    expect(classifyInclusion(1)).toEqual({ kind: 'pct', pct: 1, label: 'In 1% of decks' });
    expect(classifyInclusion(34.6)).toEqual({ kind: 'pct', pct: 35, label: 'In 35% of decks' });
    expect(classifyInclusion(87)).toEqual({ kind: 'pct', pct: 87, label: 'In 87% of decks' });
  });
});

describe('inclusionColor', () => {
  const hueOf = (color: string): number => {
    const m = /^hsl\((\d+) 60% 45%\)$/.exec(color);
    expect(m, `unexpected color format: ${color}`).toBeTruthy();
    return Number(m![1]);
  };

  it('never renders red — even a 1% "deep cut" reads as amber, not an alarm', () => {
    // classifyInclusion never lets a real signal below 1% reach inclusionColor
    // (0/no-signal renders "Off-meta" instead), so the low end only needs to
    // read as a spicy pick, not an error.
    expect(hueOf(inclusionColor(1))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(5))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(9))).toBeGreaterThanOrEqual(35);
  });

  it('reads amber/neutral for low-mid percentages', () => {
    expect(hueOf(inclusionColor(10))).toBeGreaterThanOrEqual(35);
    expect(hueOf(inclusionColor(35))).toBeGreaterThanOrEqual(35); // 35% is NOT red
    expect(hueOf(inclusionColor(35))).toBeLessThan(60); // …and not yet green
    expect(hueOf(inclusionColor(49))).toBeLessThan(60);
  });

  it('keeps the high-% green ramp unchanged from the old scale (hue = 1.2 × pct)', () => {
    expect(inclusionColor(50)).toBe('hsl(60 60% 45%)');
    expect(inclusionColor(75)).toBe('hsl(90 60% 45%)');
    expect(inclusionColor(90)).toBe('hsl(108 60% 45%)');
    expect(inclusionColor(100)).toBe('hsl(120 60% 45%)');
  });

  it('clamps out-of-range input', () => {
    expect(inclusionColor(-5)).toBe(inclusionColor(0));
    expect(inclusionColor(140)).toBe(inclusionColor(100));
  });
});

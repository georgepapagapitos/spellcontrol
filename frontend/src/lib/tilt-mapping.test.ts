import { describe, it, expect } from 'vitest';
import { captureBaseline, mapOrientationToTilt, type OrientationSample } from './tilt-mapping';

describe('captureBaseline', () => {
  it('returns the sample when both axes are present', () => {
    const sample: OrientationSample = { beta: 30, gamma: -10 };
    expect(captureBaseline(sample)).toEqual({ beta: 30, gamma: -10 });
  });

  it('returns null when beta is null', () => {
    expect(captureBaseline({ beta: null, gamma: 5 })).toBeNull();
  });

  it('returns null when gamma is null', () => {
    expect(captureBaseline({ beta: 5, gamma: null })).toBeNull();
  });

  it('returns null when both axes are null', () => {
    expect(captureBaseline({ beta: null, gamma: null })).toBeNull();
  });
});

describe('mapOrientationToTilt', () => {
  const baseline: OrientationSample = { beta: 30, gamma: -10 };

  it('returns neutral (0,0, 50,50) when deltas are zero', () => {
    const result = mapOrientationToTilt(baseline, baseline);
    expect(result).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });

  it('maps a beta delta to rx', () => {
    // delta = 3 (holding phone 3° more forward than neutral)
    const result = mapOrientationToTilt({ beta: 33, gamma: -10 }, baseline);
    expect(result.rx).toBe(3);
    expect(result.ry).toBe(0);
  });

  it('maps a gamma delta to ry', () => {
    // delta = 5 (tilted 5° right compared to neutral)
    const result = mapOrientationToTilt({ beta: 30, gamma: -5 }, baseline);
    expect(result.rx).toBe(0);
    expect(result.ry).toBe(5);
  });

  it('clamps rx to +7 when delta exceeds max', () => {
    const result = mapOrientationToTilt({ beta: 30 + 20, gamma: -10 }, baseline);
    expect(result.rx).toBe(7);
  });

  it('clamps rx to -7 when delta goes negative beyond max', () => {
    const result = mapOrientationToTilt({ beta: 30 - 20, gamma: -10 }, baseline);
    expect(result.rx).toBe(-7);
  });

  it('clamps ry to +7 when delta exceeds max', () => {
    const result = mapOrientationToTilt({ beta: 30, gamma: -10 + 20 }, baseline);
    expect(result.ry).toBe(7);
  });

  it('clamps ry to -7 when delta goes negative beyond max', () => {
    const result = mapOrientationToTilt({ beta: 30, gamma: -10 - 20 }, baseline);
    expect(result.ry).toBe(-7);
  });

  it('maps rx to my: positive rx → my < 50 (glare toward bottom)', () => {
    // rx = +7 (max forward tilt) → my = 50 - (7/7)*50 = 0
    const result = mapOrientationToTilt({ beta: 30 + 7, gamma: -10 }, baseline);
    expect(result.my).toBe(0);
  });

  it('maps rx to my: negative rx → my > 50 (glare toward top)', () => {
    // rx = -7 → my = 50 - (-7/7)*50 = 100
    const result = mapOrientationToTilt({ beta: 30 - 7, gamma: -10 }, baseline);
    expect(result.my).toBe(100);
  });

  it('maps ry to mx: positive ry → mx > 50 (glare toward right)', () => {
    // ry = +7 → mx = 50 + (7/7)*50 = 100
    const result = mapOrientationToTilt({ beta: 30, gamma: -10 + 7 }, baseline);
    expect(result.mx).toBe(100);
  });

  it('maps ry to mx: negative ry → mx < 50 (glare toward left)', () => {
    // ry = -7 → mx = 50 + (-7/7)*50 = 0
    const result = mapOrientationToTilt({ beta: 30, gamma: -10 - 7 }, baseline);
    expect(result.mx).toBe(0);
  });

  it('returns neutral when current beta is null', () => {
    const result = mapOrientationToTilt({ beta: null, gamma: -10 }, baseline);
    expect(result).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });

  it('returns neutral when current gamma is null', () => {
    const result = mapOrientationToTilt({ beta: 30, gamma: null }, baseline);
    expect(result).toEqual({ rx: 0, ry: 0, mx: 50, my: 50 });
  });

  it('handles a zero baseline (flat phone)', () => {
    const zeroBaseline: OrientationSample = { beta: 0, gamma: 0 };
    const result = mapOrientationToTilt({ beta: 3, gamma: 4 }, zeroBaseline);
    expect(result.rx).toBe(3);
    expect(result.ry).toBe(4);
  });

  it('handles simultaneous beta and gamma deltas', () => {
    // delta beta=3, delta gamma=3
    const result = mapOrientationToTilt({ beta: 33, gamma: -7 }, baseline);
    expect(result.rx).toBe(3);
    expect(result.ry).toBe(3);
    // mx = 50 + (3/7)*50 ≈ 71.43, my = 50 - (3/7)*50 ≈ 28.57
    expect(result.mx).toBeCloseTo(50 + (3 / 7) * 50, 1);
    expect(result.my).toBeCloseTo(50 - (3 / 7) * 50, 1);
  });
});

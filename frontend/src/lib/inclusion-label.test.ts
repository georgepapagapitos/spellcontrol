import { describe, expect, it } from 'vitest';
import { classifyInclusion } from './inclusion-label';

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

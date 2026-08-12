import { describe, expect, it } from 'vitest';
import {
  readTakeback,
  resolveTakebackPlan,
  takebackSummary,
  trailEntry,
  type RewindTrailEntry,
} from './takeback';

function free(summary: string | null = null): RewindTrailEntry {
  return trailEntry({ verdict: 'free', reason: 'free reason' }, summary);
}
function consent(summary: string | null = null): RewindTrailEntry {
  return trailEntry({ verdict: 'consent', reason: 'consent reason' }, summary);
}
function locked(reason = 'Drawing shows the actor a card.'): RewindTrailEntry {
  return trailEntry({ verdict: 'locked', reason }, null);
}

describe('readTakeback', () => {
  it('reports nothing to take back for an empty trail', () => {
    const readout = readTakeback([]);
    expect(readout).toEqual({ verdict: 'none', stepsAvailable: 0, boundary: null, next: null });
  });

  it('reports free when the most recent entry is free', () => {
    const trail = [free('Untapped all permanents'), consent(), locked()];
    const readout = readTakeback(trail);
    expect(readout.verdict).toBe('free');
    expect(readout.stepsAvailable).toBe(2);
    expect(readout.boundary).toBe(trail[2]);
    expect(readout.next).toBe(trail[0]);
  });

  it('reports consent when the most recent entry needs it', () => {
    const trail = [consent('Created token: Squirrel'), free(), locked()];
    const readout = readTakeback(trail);
    expect(readout.verdict).toBe('consent');
    expect(readout.stepsAvailable).toBe(2);
  });

  it('reports locked with zero steps when the wall is the newest entry', () => {
    const trail = [locked('Drew a card.'), free()];
    const readout = readTakeback(trail);
    expect(readout.verdict).toBe('locked');
    expect(readout.stepsAvailable).toBe(0);
    expect(readout.boundary?.reason).toBe('Drew a card.');
    expect(readout.next).toBeNull();
  });

  it('reports none (not locked) once every reachable entry is spent, with no wall behind it', () => {
    const readout = readTakeback([]);
    expect(readout.verdict).toBe('none');
    expect(readout.boundary).toBeNull();
  });
});

describe('resolveTakebackPlan', () => {
  it('blocks locked unconditionally — the invariant that must never be bypassed', () => {
    // Directly asserted per verdict × mode × online, since this is the one
    // rule no table setting is allowed to override.
    for (const mode of ['ask', 'free', 'off'] as const) {
      for (const online of [true, false]) {
        expect(resolveTakebackPlan('locked', mode, online)).toBe('blocked');
      }
    }
  });

  it('blocks "none" the same way as locked', () => {
    expect(resolveTakebackPlan('none', 'free', true)).toBe('blocked');
    expect(resolveTakebackPlan('none', 'ask', false)).toBe('blocked');
  });

  it('off blocks free and consent too — no takebacks at all', () => {
    expect(resolveTakebackPlan('free', 'off', false)).toBe('blocked');
    expect(resolveTakebackPlan('consent', 'off', true)).toBe('blocked');
  });

  it('free steps apply immediately regardless of mode or online-ness', () => {
    for (const mode of ['ask', 'free'] as const) {
      for (const online of [true, false]) {
        expect(resolveTakebackPlan('free', mode, online)).toBe('apply');
      }
    }
  });

  it('consent applies immediately when solo — nobody to ask', () => {
    expect(resolveTakebackPlan('consent', 'ask', false)).toBe('apply');
    expect(resolveTakebackPlan('consent', 'free', false)).toBe('apply');
  });

  it('consent applies immediately online under Free mode (trusted table)', () => {
    expect(resolveTakebackPlan('consent', 'free', true)).toBe('apply');
  });

  it('consent raises a request online under Ask mode (the default)', () => {
    expect(resolveTakebackPlan('consent', 'ask', true)).toBe('request');
  });
});

describe('takebackSummary', () => {
  it('is null with nothing to summarize', () => {
    expect(takebackSummary(null)).toBeNull();
  });

  it('uses the entry’s own summary when present', () => {
    expect(takebackSummary(free('Drew 1 card'))).toBe('Drew 1 card');
  });

  it('falls back to a generic phrase for untracked action types', () => {
    expect(takebackSummary(free(null))).toMatch(/quick adjustment/);
  });
});

// @vitest-environment node
//
// E513 round 3: a swap's stated reason makes a case for the card that came in
// (Vexing Puzzlebox for Swiftfoot Boots was stated only by what Boots gave),
// and owns up to a repair that left the trust region.
import { describe, expect, it } from 'vitest';
import type { AppliedSwap } from '../deckObjective/optimizer';
import { reasonLine } from './phaseWholeDeckSearch';

const swap = (over: Partial<AppliedSwap>): AppliedSwap =>
  ({
    out: ['Swiftfoot Boots'],
    in: ['Vexing Puzzlebox'],
    kind: 'repair',
    delta: -1,
    terms: {},
    summary: '',
    reasons: [
      { name: 'Swiftfoot Boots', term: 'interaction', value: -1.5, note: 'protection #1 (1.49)' },
      { name: 'Swiftfoot Boots', term: 'quality', value: -0.6, note: "54.7% of this page's decks" },
      { name: 'Swiftfoot Boots', term: 'curve', value: -0.4, note: 'castable on curve 99.3%' },
      { name: 'Vexing Puzzlebox', term: 'mana', value: 0.2, note: 'a rock that adds one mana' },
    ],
    ...over,
  }) as AppliedSwap;

describe('reasonLine', () => {
  it('always states a gain of the card that came in, when it has one', () => {
    const line = reasonLine(swap({}));
    expect(line).toContain('Vexing Puzzlebox: a rock that adds one mana');
    expect(line).toContain('Swiftfoot Boots: protection #1 (1.49)');
  });

  it('says so when a repair had to leave the trust region', () => {
    const line = reasonLine(
      swap({ disclosure: 'no owned card fits inside the role limits (ramp would rise to 23)' })
    );
    expect(line).toMatch(
      /Outside the usual limits, because no owned card fits inside the role limits/
    );
  });
});

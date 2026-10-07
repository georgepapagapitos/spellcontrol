// @vitest-environment node
//
// The Coach eval's Cuts lane (E540 S6): what a user following the lane would
// apply, and the lane of a deck the objective cannot score.
import { describe, expect, it } from 'vitest';
import type { Change } from '@/lib/coach/deck-change';
import type { RankedMove } from '@/lib/coach/coach-rank';
import type { CutLane } from '@/lib/coach/coach-cut-swaps';
import { cutLaneMoves, cutLaneRecord } from './coachCutLane';
import type { ShadowInput } from './coachShadow';

const cut = (name: string, reason = 'Low inclusion'): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  reason,
});
const ranked = (change: Change): RankedMove => ({ change, tier: 3, isCut: true });

describe('cutLaneMoves', () => {
  it('applies a paired swap and a repair, never today’s bare cut', () => {
    const lane: CutLane = {
      note: null,
      withheld: 0,
      rows: [
        ranked({
          ...cut('Cloud Key'),
          type: 'swap',
          name: 'Animate Dead',
          inName: 'Cloud Key',
          pairedCut: true,
        }),
        ranked(cut('Spellbook', 'The deck is over its card count, so a card has to go.')),
        ranked(cut('Ornithopter')),
      ],
    };
    expect(cutLaneMoves(lane).map((m) => [m.type, m.name, m.outName])).toEqual([
      ['swap', 'Animate Dead', 'Cloud Key'],
      ['cut', 'Spellbook', undefined],
    ]);
  });
});

describe('cutLaneRecord on a deck the objective cannot score', () => {
  it('records today’s rows and why, with no pairing', async () => {
    const commander = { name: 'Meren of Clan Nel Toth' } as never;
    const input = {
      corpus: 'advise',
      group: 'standard',
      deck: 'meren',
      state: { commander, partner: null, cards: [] },
      customization: {},
      ownedNames: new Set<string>(),
      gameChangers: new Set<string>(),
      resolve: () => undefined,
      pass: {
        // No EDHREC page: the lane keeps today's rows.
        page: null,
        analysis: { roleTargets: { ramp: 10 } },
        combos: { inDeck: [], oneAway: [] },
        view: { cuts: [ranked(cut('Cloud Key')), ranked(cut('Spellbook'))] },
      },
    } as unknown as ShadowInput;
    const { record, lane } = await cutLaneRecord(input, new Set(['cloud key', 'spellbook']));
    expect(record).toMatchObject({
      objective: 'no-page',
      legacyCuts: 2,
      withheld: 0,
      pairMs: 0,
    });
    expect(record.rows.map((r) => [r.kind, r.out])).toEqual([
      ['legacy', 'Cloud Key'],
      ['legacy', 'Spellbook'],
    ]);
    expect(lane.note).toBe('fallback');
  });
});

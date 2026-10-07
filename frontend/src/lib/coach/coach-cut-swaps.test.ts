// @vitest-environment node
//
// The Cuts lane as swaps (E540 S6) over Meren's real page, cards and combos:
// every shown cut carries a paired add the deck may hold, applying it keeps the
// deck feasible, a bare cut appears only to repair a broken rule, and a deck
// that can't be scored keeps today's rows.
import { describe, expect, it } from 'vitest';
import {
  cardIneligibility,
  checkConstraints,
} from '@/deck-builder/services/deckBuilder/deckObjective';
import { applyMove } from '@/deck-builder/services/deckBuilder/deckObjective/judge';
import { protectedCards } from '@/deck-builder/services/deckBuilder/deckObjective/protections';
import {
  BASELINE,
  FIX,
  MEREN,
  card,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildCoachObjective, type CoachObjective } from './coach-objective';
import {
  CUT_PAIRING_BUDGET_MS,
  cutLane,
  cutSwapReason,
  isPairedCut,
  keepShown,
  pairCuts,
  repairCopy,
  replacementCandidateNames,
  type CutOutcome,
} from './coach-cut-swaps';
import type { Change } from './deck-change';
import type { RankedMove } from './coach-rank';

const rows = new Map(Object.entries(FIX.merenPage));

function objective(cards: readonly ScryfallCard[] = BASELINE.cards): CoachObjective {
  const o = buildCoachObjective({
    deck: {
      format: 'commander',
      commander: MEREN,
      partnerCommander: null,
      cards: cards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
      generationContext: {
        selectedThemes: [],
        targetBracket: 'all',
        landCount: 37,
        collectionMode: false,
        customization: { deckFormat: 99, currency: 'USD' },
      },
      bracketOverride: null,
    },
    rows,
    roleTargets: FIX.meren.roleTargets,
    combos: FIX.meren.combos,
    pacing: FIX.meren.pacing,
    liftPools: new Map(Object.entries(FIX.lift)),
    manaSim: { games: 300 },
  });
  if (!o.ok) throw new Error(o.reason);
  return o;
}

const cut = (name: string, reason = 'Low inclusion'): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  reason,
});

const tryCard = (name: string): ScryfallCard | undefined => {
  try {
    return card(name);
  } catch {
    return undefined;
  }
};

// What Coach offers a Meren deck: the real staples, tutors and engines the fixture's cache holds.
const POOL = [
  'Demonic Tutor',
  'Kokusho, the Evening Star',
  'Butcher of Malakir',
  'Twilight Diviner',
  'Phyrexian Tower',
  'Natural Order',
  'Viridian Emissary',
  'Cultivate',
  'Gilded Lotus',
  'Grave Pact',
  'Hermit Druid',
  'Counterspell',
  'Enlightened Tutor',
]
  .map(tryCard)
  .filter((c): c is ScryfallCard => !!c);

const CUTS = ['Skull Prophet', 'Strionic Resonator', 'Dread Return', 'Life // Death', 'Skullclamp'];
const env = (obj: CoachObjective, over: Partial<Parameters<typeof pairCuts>[1]> = {}) => ({
  objective: obj,
  resolve: tryCard,
  candidates: POOL,
  ownership: () => 'unowned' as const,
  ...over,
});

describe('pairing Meren’s cuts with replacements', { timeout: 300_000 }, () => {
  const obj = objective();
  let outcomes: Map<string, CutOutcome>;
  const cuts = CUTS.map((n) => cut(n));

  it('pairs each shown cut with an add the deck may hold, the cut leading one swap row', async () => {
    outcomes = await pairCuts(cuts, env(obj));
    const swaps = [...outcomes.values()].filter((o) => o.status === 'swap');
    expect(swaps.length).toBeGreaterThan(0);
    for (const o of swaps) {
      if (o.status !== 'swap') continue;
      const c = o.change;
      expect(c.type).toBe('swap');
      expect(isPairedCut(c)).toBe(true);
      // One apply: the page's swap path reads `inName` (the cut) and adds `name`.
      expect(CUTS).toContain(c.inName);
      expect(c.id).toBe(`upgrade:cut:${c.inName}`);
      const incoming = card(c.name);
      // Eligible under the deck's settings, and not already in the deck.
      expect(cardIneligibility(incoming, obj.ctx), c.name).toBeNull();
      expect(BASELINE.cards.some((d) => d.name === c.name)).toBe(false);
      // Applying the swap keeps the deck feasible.
      const out = BASELINE.cards.findIndex((d) => d.name === c.inName);
      const after = applyMove(BASELINE, { out: [out], in: [incoming] });
      expect(checkConstraints(after, obj.ctx), c.name).toEqual([]);
    }
  });

  it('never takes a protected card out, and never offers one replacement twice', () => {
    const held = protectedCards(obj.deck, obj.ctx);
    const taken = new Set<string>();
    for (const o of outcomes.values()) {
      if (o.status !== 'swap') continue;
      expect(held.has(o.change.inName!), o.change.inName).toBe(false);
      expect(taken.has(o.change.name), `${o.change.name} offered twice`).toBe(false);
      taken.add(o.change.name);
    }
  });

  it('says why in at most two plain sentences, with the cut named first', () => {
    for (const o of outcomes.values()) {
      if (o.status !== 'swap') continue;
      const reason = o.change.reason ?? '';
      const sentences = reason.split(/(?<=\.)\s+/);
      expect(sentences.length, reason).toBeLessThanOrEqual(2);
      expect(sentences[0], reason).toContain(o.change.inName!);
      expect(reason).not.toMatch(/—|\.\.\.|!|\bplease\b|\bsimply\b/i);
    }
  });

  it('shows a cut with no replacement and no rule to fix as nothing, not as a bare cut', async () => {
    const none = await pairCuts([cut('Skull Prophet')], env(obj, { candidates: [] }));
    expect(none.get('upgrade:cut:Skull Prophet')).toMatchObject({ status: 'none' });
    // A bare cut from a full, legal deck repairs nothing.
    const lane = cutLane(
      [{ change: cut('Skull Prophet'), tier: 3, isCut: true }],
      { status: 'ready', outcomes: none },
      new Set()
    );
    expect(lane.rows).toEqual([]);
    expect(lane.withheld).toBe(1);
  });

  it('keeps a bare cut when it repairs a broken rule, and says which', async () => {
    // 100 cards in a 99-card slot count: one card over, so any cut repairs the size.
    const over = [...BASELINE.cards, card('Gilded Lotus')];
    const o = objective(over);
    const res = await pairCuts([cut('Strionic Resonator')], env(o, { candidates: [] }));
    const r = res.get('upgrade:cut:Strionic Resonator')!;
    expect(r.status).toBe('repair');
    if (r.status !== 'repair') return;
    expect(r.change.type).toBe('cut');
    expect(r.change.reason).toBe(repairCopy(['size']));
    expect(r.change.reason).toMatch(/card count/);
  });

  it('keeps legacy order, scored rows first and unscored rows below', () => {
    const legacy: RankedMove[] = ['Skull Prophet', 'Strionic Resonator', 'Dread Return'].map(
      (n) => ({ change: cut(n), tier: 3, isCut: true })
    );
    const swap = (n: string, into: string): CutOutcome => ({
      status: 'swap',
      change: { ...cut(n), type: 'swap', name: into, inName: n, pairedCut: true },
    });
    const lane = cutLane(
      legacy,
      {
        status: 'ready',
        outcomes: new Map<string, CutOutcome>([
          ['upgrade:cut:Strionic Resonator', swap('Strionic Resonator', 'Cultivate')],
          ['upgrade:cut:Dread Return', { status: 'unscored', reason: 'over-budget' }],
          ['upgrade:cut:Skull Prophet', swap('Skull Prophet', 'Gilded Lotus')],
        ]),
      },
      new Set()
    );
    expect(lane.rows.map((r) => r.change.id)).toEqual([
      'upgrade:cut:Skull Prophet',
      'upgrade:cut:Strionic Resonator',
      'upgrade:cut:Dread Return',
    ]);
    expect(lane.rows[2].change.type).toBe('cut');
  });

  it('returns rows past the time budget as unscored, in today’s order', async () => {
    let t = 0;
    const late = await pairCuts(cuts, {
      ...env(obj),
      budgetMs: 10,
      // Each look at the clock is 20 ms later: the first row is already over budget.
      now: () => (t += 20),
    });
    expect([...late.values()].every((o) => o.status === 'unscored')).toBe(true);
    expect(CUT_PAIRING_BUDGET_MS).toBe(4000);
  });
});

describe('a re-pairing after an apply', () => {
  const swap = (cutName: string, into: string): CutOutcome => ({
    status: 'swap',
    change: { ...cut(cutName), type: 'swap', name: into, inName: cutName, pairedCut: true },
  });
  const id = (n: string) => `upgrade:cut:${n}`;

  it('keeps the card a row already shows, so a click lands on what was read', () => {
    const prev = new Map<string, CutOutcome>([
      [id('Shriekmaw'), swap('Shriekmaw', 'Scute Swarm')],
      [id('Spellbook'), { status: 'none', reason: 'x' }],
    ]);
    const next = new Map<string, CutOutcome>([
      [id('Shriekmaw'), swap('Shriekmaw', "Ashnod's Altar")],
      // A withheld row stays withheld: a new row appearing would shift the ones being read.
      [id('Spellbook'), swap('Spellbook', 'Cultivate')],
      [id('Ornithopter'), swap('Ornithopter', 'Gilded Lotus')],
    ]);
    const kept = keepShown(prev, next, () => false);
    expect(kept.get(id('Shriekmaw'))).toBe(prev.get(id('Shriekmaw')));
    expect(kept.get(id('Spellbook'))).toBe(prev.get(id('Spellbook')));
    // What is new is decided by the new run.
    expect(kept.get(id('Ornithopter'))).toBe(next.get(id('Ornithopter')));
  });

  it('takes the new verdict when the shown replacement has since entered the deck', () => {
    const prev = new Map<string, CutOutcome>([[id('Shriekmaw'), swap('Shriekmaw', 'Scute Swarm')]]);
    const next = new Map<string, CutOutcome>([
      [id('Shriekmaw'), swap('Shriekmaw', "Ashnod's Altar")],
    ]);
    expect(keepShown(prev, next, (n) => n === 'Scute Swarm').get(id('Shriekmaw'))).toBe(
      next.get(id('Shriekmaw'))
    );
  });

  it('never gives a kept replacement to a second row', () => {
    const prev = new Map<string, CutOutcome>([[id('A'), swap('A', 'Cultivate')]]);
    const next = new Map<string, CutOutcome>([
      [id('A'), swap('A', 'Cultivate')],
      [id('B'), swap('B', 'Cultivate')],
    ]);
    expect(keepShown(prev, next, () => false).get(id('B'))).toMatchObject({ status: 'none' });
  });
});

describe('a deck the objective cannot score', () => {
  it('keeps today’s cut rows, never a blank lane', () => {
    const legacy: RankedMove[] = CUTS.map((n) => ({ change: cut(n), tier: 3, isCut: true }));
    for (const status of ['fallback', 'error'] as const) {
      const lane = cutLane(
        legacy,
        status === 'fallback' ? { status, reason: 'no-page' } : { status },
        new Set()
      );
      expect(lane.rows.map((r) => r.change.id)).toEqual(legacy.map((r) => r.change.id));
      expect(lane.note).toBe(status);
    }
  });

  it('names the reasons: no page, a thin page', () => {
    const base = {
      deck: {
        format: 'commander' as const,
        commander: MEREN,
        partnerCommander: null,
        cards: BASELINE.cards.map((c, i) => ({
          slotId: String(i),
          card: c,
          allocatedCopyId: null,
        })),
        generationContext: null,
        bracketOverride: null,
      },
      roleTargets: FIX.meren.roleTargets,
    };
    expect(buildCoachObjective({ ...base, rows: new Map() })).toEqual({
      ok: false,
      reason: 'no-page',
    });
    const few = new Map([...rows].slice(0, 5));
    expect(buildCoachObjective({ ...base, rows: few })).toEqual({ ok: false, reason: 'thin-page' });
  });
});

describe('the words of a cut and its replacement', () => {
  it('restates the objective’s past-tense notes for a proposal', () => {
    const text = cutSwapReason(cut('Skull Prophet'), 'Skull Prophet', 'Grave Pact', [
      { name: 'Grave Pact', term: 'quality', value: 1, note: "41% of this page's decks" },
      { name: 'Skull Prophet', term: 'quality', value: 1, note: "6% of this page's decks" },
    ]);
    expect(text).toBe(
      "Skull Prophet is in only 6% of this commander's decks. Grave Pact is in 41% of this commander's decks."
    );
  });

  it('says the role counts a swap moves as the swap’s, never the card coming in’s', () => {
    // Animate Dead is not ramp: the ramp count moves because the rock leaves.
    const text = cutSwapReason(cut('Cloud Key'), 'Cloud Key', 'Animate Dead', [
      { name: 'Animate Dead', term: 'quality', value: 1, note: "35% of this page's decks" },
      { name: 'Cloud Key', term: 'quality', value: 1, note: "0% of this page's decks" },
      { name: 'Animate Dead', term: 'roles', value: 0.3, note: 'roles: ramp 16 → 15 of target 12' },
    ]);
    expect(text).toBe(
      "Cloud Key is not played with this commander. Animate Dead is in 35% of this commander's decks and the swap moves the deck's ramp from 16 to 15 (aiming for 12)."
    );
  });

  it('falls back to the engine’s own label for the card that leaves', () => {
    expect(cutSwapReason(cut('Swamp', 'Excess Ramp'), 'Swamp', 'Cultivate', [])).toMatch(
      /^Swamp is more ramp than the deck needs\./
    );
  });

  it('leaves the play rate to the row when the card coming in has another reason', () => {
    const text = cutSwapReason(cut('Ornithopter'), 'Ornithopter', 'Vito', [
      { name: 'Vito', term: 'quality', value: 1, note: "12% of this page's decks" },
      {
        name: 'Vito',
        term: 'synergy',
        value: 1,
        note: 'pays off lifegain (payoff 1 of 3), fed by High Market, Haywire Mite and 1 more',
        names: ['High Market', 'Haywire Mite', 'Gray Merchant of Asphodel'],
      },
      { name: 'Ornithopter', term: 'quality', value: 1, note: "0% of this page's decks" },
    ]);
    // No "12% of decks" (the row shows it), and no list of feeders (the row has no room).
    expect(text).toBe(
      "Ornithopter is not played with this commander. Vito pays off the deck's lifegain theme."
    );
  });

  it('fixes the generation copy’s article and a zero play rate', () => {
    const text = cutSwapReason(
      { ...cut('Fyndhorn Elves'), inclusion: 0 },
      'Fyndhorn Elves',
      'Intruder Alarm',
      [{ name: 'Intruder Alarm', term: 'interaction', value: 1, note: 'answer #3: static (0.8)' }]
    );
    expect(text).toBe(
      'Fyndhorn Elves is not played with this commander. Intruder Alarm adds a static-speed answer.'
    );
  });

  it('words the legacy labels a basic land or an off-plan card carries', () => {
    const basics = cutSwapReason(
      cut('Island', 'Swap for a Plains. Too many blue basics.'),
      'Island',
      "Urza's Saga",
      []
    );
    expect(basics).toMatch(/^The deck has more blue basics than it needs\./);
    expect(
      cutSwapReason(
        cut('Spellbook', 'Off-package: no co-play links with your key cards'),
        'Spellbook',
        'Cultivate',
        []
      )
    ).toMatch(/^Spellbook has no co-play links with this deck's key cards\./);
  });

  it('words each repaired rule', () => {
    expect(repairCopy(['budget'])).toBe('The deck is over its budget.');
    expect(repairCopy(['game-changers'])).toBe('The deck is over its Game Changer limit.');
    expect(repairCopy(['banned'])).toBe("This card is banned in this deck's settings.");
    expect(repairCopy(['unheard-of'])).toMatch(/breaks a rule you set/);
  });

  it('builds the replacement pool from what Coach offers, owned cards by play rate', () => {
    const names = replacementCandidateNames({
      gaps: [{ name: 'Sol Ring' }],
      hiddenGems: [{ name: 'Gem' }],
      additions: [{ name: 'Sol Ring' }],
      synergy: [{ cardName: 'Syn' }],
      ownedNames: new Set(['A', 'B', 'C']),
      inclusionOf: (n) => ({ A: 10, B: 30, C: 0 })[n] ?? 0,
      ownedLimit: 1,
    });
    expect(names).toEqual(['Sol Ring', 'Gem', 'Syn', 'B']);
  });
});

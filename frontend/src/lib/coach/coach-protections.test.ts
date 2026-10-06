// @vitest-environment node
//
// Guard (E540 S3): ONE protection set, read by every Coach cut path and by the
// whole-deck objective. A card held by the set is refused by the overlap cut,
// the replace-when-full prompt, the combo cut and `judgeMove` alike; before
// this, each path kept its own list and a path missing a protection offered
// the card the others kept (the overlap path cut a FLAGGED finisher and any
// survival piece; `judgeMove` knew none of them).
// The cases are the T171 #2635 gate's, with real cards (Scryfall 2026-09-29)
// and the pinned tagger fixture for roles. The excess and misfit paths read
// the same set through the analysis (analyzeCommanderDeck.protections.test.ts).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import {
  COACH_CARDS,
  coachCardFactsSnapshot,
} from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { judgeMove } from '@/deck-builder/services/deckBuilder/deckObjective/judge';
import {
  protectedCards,
  protectionOf,
} from '@/deck-builder/services/deckBuilder/deckObjective/protections';
import {
  BASELINE,
  FIX,
  MEREN,
  merenCtx,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { buildCoachObjective } from './coach-objective';
import { createCoachProtections, wouldBeSuggestedBack } from './coach-protections';
import { rankReplacementCuts, type CutAnalysis, type CutCandidate } from './intelligent-cuts';
import { replaceCuts } from './replace-cuts';

const here = dirname(fileURLToPath(import.meta.url));
const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const slots = (names: string[]): CutCandidate[] =>
  names.map((name, i) => ({ slotId: `s${i}`, card: real(name) }));
const names = (cuts: { card: ScryfallCard }[]) => cuts.map((c) => c.card.name);
const weak = (name: string): OptimizeCard =>
  ({
    name,
    reason: 'Low inclusion',
    reasonCategory: 'low-inclusion',
    inclusion: 1,
  }) as OptimizeCard;

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(
      resolve(
        here,
        '../../deck-builder/services/deckBuilder/__fixtures__/tagger-tags.fixture.json'
      ),
      'utf8'
    )
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => setCardFactsSnapshot(null));

// What each case holds, in the cut paths' own terms: the incoming card, the
// commander, the deck's analysis, and the card that must stay.
interface Held {
  label: string;
  kept: string;
  add: string;
  commander?: string;
  deck: string[];
  /** The deck's other card: still a cut, so the guard is the held card and not the lane. */
  other?: string;
  analysis?: CutAnalysis;
  /** The card is flagged weak: a flag is no licence to cut a held card. The floor holds only unflagged ones. */
  flagged?: boolean;
}
const HELD: Held[] = [
  {
    label: 'premium: efficient interaction (Path to Exile)',
    kept: 'Path to Exile',
    add: 'Rakdos Signet',
    deck: ['Path to Exile', 'Aetherjacket'],
  },
  {
    label: "the commander's plan (Drakuseth, an Isshin attack-trigger payoff)",
    kept: 'Drakuseth, Maw of Flames',
    add: 'Rakdos Signet',
    commander: 'Isshin, Two Heavens as One',
    deck: ['Drakuseth, Maw of Flames', 'Crib Swap'],
    other: 'Crib Swap',
  },
  {
    label: 'a finisher (Starfield of Nyx, Sythis)',
    kept: 'Starfield of Nyx',
    add: 'Resurgent Belief',
    deck: ['Starfield of Nyx', 'Aetherjacket'],
  },
  {
    label: "a survival piece (Teferi's Protection)",
    kept: "Teferi's Protection",
    add: 'Rakdos Signet',
    commander: "Yuriko, the Tiger's Shadow",
    deck: ["Teferi's Protection", 'Aetherjacket'],
  },
  {
    label: 'a card Coach would suggest straight back (a 34% staple over the 30% floor)',
    kept: 'Diregraf Colossus',
    add: 'Mystic Remora',
    deck: ['Diregraf Colossus', 'Aetherjacket'],
    flagged: false,
    analysis: {
      cardInclusionMap: { 'Diregraf Colossus': 34 },
      gapAnalysis: [{ name: 'Mystic Remora', inclusion: 30 }],
    },
  },
];

function cutsOf(h: Held, path: 'overlap' | 'combo' | 'replace'): string[] {
  const analysis: CutAnalysis = {
    ...(h.commander ? { commander: real(h.commander) } : {}),
    ...h.analysis,
  };
  const removals = [
    ...(h.flagged === false ? [] : [weak(h.kept)]),
    weak(h.other ?? 'Aetherjacket'),
  ];
  const deckCards = slots(h.deck);
  if (path === 'replace') {
    return names(
      replaceCuts({
        deckCards,
        analysis: { ...analysis, optimizeSwaps: { removals } as never },
        full: true,
      }).cutsFor(real(h.add))
    );
  }
  return names(
    rankReplacementCuts({
      addCard: real(h.add),
      deckCards,
      analysis,
      removals,
      completesCombo: path === 'combo',
    })
  );
}

describe('every Coach cut path refuses a card the one set holds', () => {
  for (const h of HELD) {
    describe(h.label, () => {
      it.each(['overlap', 'replace', 'combo'] as const)('the %s cut leaves it', (path) => {
        setCardFactsSnapshot(coachCardFactsSnapshot());
        const cuts = cutsOf(h, path);
        expect(cuts).not.toContain(h.kept);
        expect(cuts).toContain(h.other ?? 'Aetherjacket');
      });

      it('the control: the same deck without the card held offers it', () => {
        // Cutting Aetherjacket's twin shows the fixture can offer a flagged card at all.
        const cuts = rankReplacementCuts({
          addCard: real(h.add),
          deckCards: slots(['Crib Swap', 'Aetherjacket']),
          removals: [weak('Crib Swap')],
        });
        expect(names(cuts)).toContain('Crib Swap');
      });
    });
  }
});

describe('an engine piece leaves only for a card on its own axis', () => {
  // A tribal deck: Death Baron and Goblin Warchief pay off the tribe, Goblin
  // Matron makes it, so tribal is the deck's engine.
  const engine = [
    'Death Baron',
    'Goblin Warchief',
    'Goblin Matron',
    'Diregraf Colossus',
    'Aetherjacket',
  ];
  const run = (add: string, completesCombo = false) => {
    const deckCards = slots(engine);
    return names(
      rankReplacementCuts({
        addCard: real(add),
        deckCards,
        deckSynergy: analyzeDeckSynergy(deckCards.map((d) => d.card)),
        removals: engine.map(weak),
        completesCombo,
      })
    );
  };

  it('refuses it for an unrelated add, and for a combo completion', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    for (const cuts of [run('Rakdos Signet'), run('Rakdos Signet', true)]) {
      expect(cuts).not.toContain('Death Baron');
      expect(cuts).not.toContain('Goblin Matron');
      expect(cuts).not.toContain('Diregraf Colossus');
      expect(cuts).toContain('Aetherjacket');
    }
  });

  it('offers a payoff to an add that is a payoff of the same engine, and no producer', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const cuts = run('Undead Warchief');
    expect(cuts).toContain('Death Baron');
    expect(cuts).not.toContain('Goblin Matron');
  });
});

describe('the whole-deck objective reads the same set (judgeMove)', { timeout: 120_000 }, () => {
  // Meren's real deck: a card Coach's set holds and the objective's own does not.
  const saved = {
    format: 'commander' as const,
    commander: MEREN,
    partnerCommander: null,
    cards: BASELINE.cards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
    generationContext: {
      selectedThemes: [],
      targetBracket: 'all' as const,
      landCount: 37,
      collectionMode: false,
      customization: { deckFormat: 99, currency: 'USD' as const },
    },
    bracketOverride: null,
  };
  const built = () => {
    const r = buildCoachObjective({
      deck: saved,
      rows: new Map(Object.entries(FIX.merenPage)),
      roleTargets: FIX.meren.roleTargets,
      combos: FIX.meren.combos,
      pacing: FIX.meren.pacing,
      liftPools: new Map(Object.entries(FIX.lift)),
      manaSim: { games: 400 },
    });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };

  it('refuses to cut an engine piece, with the set’s own reason (Animate Dead, Meren)', () => {
    const { ctx, deck } = built();
    expect(
      protectionOf(
        deck.cards.find((c) => c.name === 'Animate Dead')!,
        deck,
        ctx
      )?.cls
    ).toBe('engine piece');
    const verdict = judgeMove(deck, { out: ['Animate Dead'], in: [] }, ctx, { partial: true });
    expect(verdict.accepted).toBe(false);
    expect(verdict.refusal).toContain('Animate Dead is an engine piece');
  });

  it('agrees with the paths: every card the set holds is held in the context', () => {
    const { ctx, deck } = built();
    const set = createCoachProtections({
      commanders: [MEREN],
      invested: analyzeDeckSynergy([...deck.cards]).invested,
      inclusionOf: (n) => FIX.merenPage[n]?.inclusion,
    });
    for (const c of deck.cards) {
      if (!set(c)) continue;
      expect(protectionOf(c, deck, ctx), c.name).not.toBeNull();
    }
  });

  it('holds nothing extra when a context has no hook (generation is unchanged)', () => {
    const { deck } = built();
    const bare = merenCtx();
    const coach = new Set([
      'premium',
      'commander plan',
      'engine piece',
      'finisher',
      'survival piece',
    ]);
    for (const [, p] of protectedCards(deck, bare)) expect(coach.has(p.cls)).toBe(false);
    expect(bare.extraProtections).toBeUndefined();
  });
});

describe('the missing-staple floor', () => {
  it('is one predicate for the replace prompt and the budget lane', () => {
    const gaps = [{ inclusion: 45 }, { inclusion: 30 }, { inclusion: 0 }];
    expect(wouldBeSuggestedBack(30, gaps)).toBe(true);
    expect(wouldBeSuggestedBack(29.9, gaps)).toBe(false);
    expect(wouldBeSuggestedBack(undefined, gaps)).toBe(false);
    expect(wouldBeSuggestedBack(80, [])).toBe(false);
  });
});

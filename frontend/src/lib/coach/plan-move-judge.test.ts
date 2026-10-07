// @vitest-environment node
//
// The plans' judge over Meren's real page, cards and combos (the objective
// fixture): it refuses the cuts the shared protection set holds, a swap that
// leaves the deck's colors, judges each pick against the picks before it, and
// says "unscored" for what it cannot read, never a guess.
import { describe, expect, it } from 'vitest';
import {
  BASELINE,
  FIX,
  MEREN,
  card,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildCoachObjective, type CoachObjectiveResult } from './coach-objective';
import { createPlanJudge } from './plan-move-judge';

const rows = new Map(Object.entries(FIX.merenPage));

function objective(cards: readonly ScryfallCard[] = BASELINE.cards): CoachObjectiveResult {
  return buildCoachObjective({
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
}

const resolve = (name: string) => {
  try {
    return card(name);
  } catch {
    return undefined;
  }
};

describe('createPlanJudge on Meren', { timeout: 300_000 }, () => {
  const obj = objective();
  const judge = createPlanJudge(obj, resolve)!;

  it('has no judge for a deck the objective cannot score', () => {
    expect(createPlanJudge({ ok: false, reason: 'no-page' }, resolve)).toBeNull();
  });

  it('accepts a swap that clears the objective margin', () => {
    // The same real swap the Cuts lane scorer test accepts.
    expect(judge.verdict({ name: 'Grave Pact' }, 'Strionic Resonator', [])).toMatchObject({
      status: 'ok',
    });
  });

  it('refuses a swap that leaves the commander colors', () => {
    expect(judge.verdict({ name: 'Counterspell' }, 'Strionic Resonator', [])).toMatchObject({
      status: 'refused',
      reason: 'breaks identity',
    });
  });

  it('refuses a cut the protection set holds, a tutor that finds a Mikaeus combo piece', () => {
    const v = judge.verdict({ name: 'Grave Pact' }, 'Vampiric Tutor', []);
    expect(v.status).toBe('refused');
    expect(v.status === 'refused' && v.reason).toMatch(/tutor|combo|staple|premium/i);
  });

  it('judges a pick against the deck the picks before it left', () => {
    // After the first pick took Strionic Resonator out, it is no longer there to cut.
    const prior = [{ add: 'Grave Pact', cut: 'Strionic Resonator' }];
    expect(judge.verdict({ name: 'Cultivate' }, 'Strionic Resonator', prior)).toEqual({
      status: 'unscored',
    });
  });

  it('is unscored for a card it cannot resolve, and for a cut that is not in the deck', () => {
    expect(judge.verdict({ name: 'Not A Card' }, 'Strionic Resonator', [])).toEqual({
      status: 'unscored',
    });
    expect(judge.verdict({ name: 'Grave Pact' }, 'Black Lotus', [])).toEqual({
      status: 'unscored',
    });
  });
  it('calls an add to a short deck a loss only when it makes the deck worse', () => {
    const short = createPlanJudge(objective(BASELINE.cards.slice(0, 90)), resolve)!;
    expect(short.loss({ name: 'Grave Pact' }, [])).toEqual({ loss: false });
    expect(short.loss({ name: 'Counterspell' }, [])).toMatchObject({
      loss: true,
      reason: 'breaks identity',
      hard: true,
    });
  });

  it('reads a Game Changer as premium, and an identity break as hard', () => {
    const short = createPlanJudge(objective(BASELINE.cards.slice(0, 90)), resolve)!;
    // Fierce Guardianship is a Game Changer outside Meren's colors: premium, and the colors are a hard rule.
    expect(short.loss({ name: 'Fierce Guardianship' }, [])).toMatchObject({
      loss: true,
      hard: true,
      premium: true,
    });
  });
  it('reads a back face that shares a held card name as soft, not a hard rule break', () => {
    // Emeritus of Woe // Demonic Tutor (sos): a distinct card whose BACK face is named like the
    // Demonic Tutor the deck holds. Commander keeps it; Fill must not treat it as a duplicate.
    const emeritus = {
      id: 'sos-emeritus-of-woe',
      name: 'Emeritus of Woe // Demonic Tutor',
      mana_cost: '{3}{B} // {1}{B}',
      cmc: 4,
      type_line: 'Creature — Vampire Warlock // Sorcery',
      color_identity: ['B'],
      colors: ['B'],
      set: 'sos',
      layout: 'prepare',
      legalities: { commander: 'legal' },
      card_faces: [
        { name: 'Emeritus of Woe', type_line: 'Creature — Vampire Warlock' },
        {
          name: 'Demonic Tutor',
          type_line: 'Sorcery',
          oracle_text:
            'Search your library for a card, put that card into your hand, then shuffle.',
        },
      ],
    } as unknown as ScryfallCard;
    const base = BASELINE.cards.slice(0, 90).filter((c) => c.name !== 'Demonic Tutor');
    const withTutor = createPlanJudge(objective([...base, card('Demonic Tutor')]), (n) =>
      n === emeritus.name ? emeritus : resolve(n)
    )!;
    const v = withTutor.loss({ name: emeritus.name, card: emeritus }, []);
    expect(v.loss === true && v.hard).not.toBe(true);
  });
});

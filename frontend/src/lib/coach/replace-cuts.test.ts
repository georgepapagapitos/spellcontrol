// Guard (T171 round 3): on a full deck, 366 of the harness's top-10 rows were
// adds whose replace prompt had no valid cut. They stay in the feed, but rank
// below every row that has a cut or needs none, through the prompt's own
// logic (replace-cuts.ts), so rank and prompt can't disagree. An add that
// newly completes one of the deck's one-away combos keeps its place. Real cards (Scryfall 2026-09-29) with the
// pinned tagger fixture for roles.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { COACH_CARDS } from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { replaceCuts } from './replace-cuts';
import { rankCoachMoves, type CoachContext } from './coach-rank';
import { fromComboCompletion, fromOptimizeCard, fromSynergySuggestion } from './deck-change';

const here = dirname(fileURLToPath(import.meta.url));
const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });

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

const sub = (value: number) => ({ value, surface: '', bandLabel: '', partial: false });

describe('rankCoachMoves — adds the replace prompt has no cut for', () => {
  // Removal 2 of 2: Beast Within is an upgrade inside removal, and neither
  // removal spell is flagged weak, so the prompt has no cut for it.
  const inputs = {
    deckCards: ['Murder', 'Doom Blade', 'Harmonize', 'Aetherjacket'].map((n, i) => ({
      slotId: `s${i}`,
      card: real(n),
    })),
    analysis: {
      roleTargets: { removal: 2, cardDraw: 0 },
      gapAnalysis: [{ name: 'Sol Ring', inclusion: 80 }],
    },
    full: true,
    resolve: (name: string) => (COACH_CARDS[name] ? real(name) : undefined),
  };
  const beastWithin = fromOptimizeCard(
    {
      name: 'Beast Within',
      reason: 'Theme synergy',
      reasonCategory: 'theme',
      role: 'removal',
      inclusion: null,
    },
    'add',
    'unowned'
  );
  // A budding-engine pick: tier 3, with a valid cut (Aetherjacket).
  const solRing = fromSynergySuggestion(
    {
      cardName: 'Sol Ring',
      axis: 'artifacts',
      axisLabel: 'Artifacts',
      side: 'producer',
      reason: 'an artifact',
      inclusion: 80,
      budding: true,
    },
    'unowned'
  );
  const comboMatch = {
    combo: {
      id: 'bm',
      produces: ['Infinite colorless mana'],
      popularity: 900,
      cards: [
        { oracleId: 'Harmonize', cardName: 'Harmonize', quantity: 1 },
        { oracleId: 'Beast Within', cardName: 'Beast Within', quantity: 1 },
      ],
    },
    presentOracleIds: ['Harmonize'],
    missingOracleIds: ['Beast Within'],
  } as unknown as ComboMatch;
  const completesCombo = fromComboCompletion(comboMatch, 'Beast Within', 'unowned');
  const ctx: CoachContext = {
    planScore: {
      overall: 60,
      bandLabel: '',
      headline: '',
      byline: '',
      limitedData: false,
      subscores: { strategy: sub(80), roles: sub(80), curve: sub(80), cardFit: sub(50) },
    },
    roleCounts: { removal: 2, cardDraw: 1 },
    roleTargets: { removal: 2, cardDraw: 0 },
    deckSize: 100,
    deckTarget: 100,
    bracketOverridePresent: false,
    ownedNames: new Set(),
  };

  it('agrees with the prompt: no cut for the upgrade, a cut for the other add', () => {
    const cuts = replaceCuts(inputs);
    expect(cuts.cutsFor(real('Beast Within'))).toEqual([]);
    expect(cuts.hasCut(beastWithin)).toBe(false);
    expect(cuts.cutsFor(real('Sol Ring')).map((c) => c.card.name)).toContain('Aetherjacket');
    expect(cuts.hasCut(solRing)).toBe(true);
  });

  it('ranks an add with no cut below a lower-tier add with one; a combo the prompt knows keeps its place', () => {
    const plain = rankCoachMoves([beastWithin, solRing, completesCombo], ctx);
    // By tier alone the upgrade (cardFit 50) leads the budding pick.
    expect(plain.find((r) => r.change === beastWithin)?.tier).toBe(1);
    expect(plain.find((r) => r.change === solRing)?.tier).toBe(3);
    expect(plain[0].change).toBe(beastWithin);

    const hasReplaceCut = replaceCuts(inputs).hasCut;
    const ranked = rankCoachMoves([beastWithin, solRing, completesCombo], {
      ...ctx,
      hasReplaceCut,
    });
    const names = ranked.map((r) => `${r.change.lane}:${r.change.name}`);
    expect(names.indexOf('upgrade:Sol Ring')).toBeLessThan(names.indexOf('upgrade:Beast Within'));
    expect(names.indexOf('upgrade:Sol Ring')).toBeLessThan(names.indexOf('combos:Beast Within'));

    // The prompt reads the one-away combo: the completion keeps its place.
    const knows = replaceCuts({ ...inputs, oneAwayCombos: [comboMatch] });
    expect(knows.hasCut(completesCombo)).toBe(true);
    const kept = rankCoachMoves([solRing, completesCombo], { ...ctx, hasReplaceCut: knows.hasCut });
    expect(kept.map((r) => r.change)).toEqual(
      rankCoachMoves([solRing, completesCombo], ctx).map((r) => r.change)
    );
  });

  it('never reorders a deck with room', () => {
    const roomy = replaceCuts({ ...inputs, full: false });
    expect(roomy.hasCut(beastWithin)).toBe(true);
  });
});

/**
 * Writes an optimized deck back as a LIVE_GEN panel dump, in the harness's own
 * format (deckGenerator.live.test.ts), so the ship-gate workflow and prescan
 * read it unchanged next to the generator's dump it came from.
 *
 * Everything that describes the CARDS is recomputed from the new list with
 * the same functions the harness and the generator use: the decklist (the
 * swapped-in cards projected like the harness projects a card), roleCounts
 * and roleCardNames (computeRoleCounts / countedRoleOf), stats (calculateStats),
 * the manabase summary, protectionCount, combo completeness and the bracket
 * estimate. The rest of the report is brought up to the final list by
 * panelReport.ts (recomputed where the generator's functions can run, kept
 * only while true where they can't), and a new note (`allNotes.optimizerNote`,
 * `buildReport.optimizerSwaps`) says what the search changed afterwards and
 * why, card by card.
 *
 * Script-only (scripts/deck-objective-optimize.mjs through harness.ts): it
 * reaches the generator's analysis modules, so it stays out of the
 * objective's layered graph (layering.test.ts).
 */
import type {
  DeckCategory,
  DetectedCombo,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import { getByCardName } from '@/lib/cards/card-text';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { getCardTags, validateCardRole } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts, countProtectionPieces, countedRoleOf } from '../commanderDeckAnalysis';
import { calculateStats } from '../deckStats';
import { buildManabaseSummary } from '../manabaseMath';
import { estimateBracket } from '../bracketEstimator';
import { gameChangerNamesFor } from './constraints';
import { isLandCard } from './context';
import type { OptimizeResult } from './optimizer';
import type { DumpCard, PanelDump } from './panelDump';
import { refreshReport } from './panelReport';
import type { ObjectiveContext, ObjectiveDeck } from './types';

type Dump = PanelDump & Record<string, unknown>;

function oracleTextOf(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  return (card.card_faces ?? [])
    .map((f) => f.oracle_text ?? '')
    .filter(Boolean)
    .join(' // ');
}

/** A card as the harness projects it (projectCard). */
export function projectCard(
  card: ScryfallCard,
  ctx: ObjectiveContext
): DumpCard & Record<string, unknown> {
  return {
    name: card.name,
    mana_cost: card.mana_cost ?? null,
    cmc: card.cmc,
    type_line: card.type_line,
    color_identity: card.color_identity,
    rarity: card.rarity,
    set: card.set,
    games: card.games ?? null,
    legalities: {
      commander: card.legalities?.commander ?? null,
      paupercommander: card.legalities?.paupercommander ?? null,
      brawl: card.legalities?.brawl ?? null,
    },
    price_usd: getCardPrice(card, 'USD'),
    price_eur: getCardPrice(card, 'EUR'),
    oracle_text_snippet: oracleTextOf(card).slice(0, 140),
    edhrec_inclusion: getByCardName(ctx.edhrec, card.name)?.inclusion ?? null,
    role: validateCardRole(card),
    countedRole: countedRoleOf(card),
    tags: getCardTags(card.name),
  };
}

/**
 * The bucket a swapped-in card goes to. Dump buckets are TYPE-routed first
 * (a creature sits in `creatures` whatever it does), then by counted role.
 */
function bucketOf(card: ScryfallCard): DeckCategory {
  if (isLandCard(card)) return 'lands';
  const front = card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
  if (/\bCreature\b/.test(front)) return 'creatures';
  switch (countedRoleOf(card)) {
    case 'ramp':
      return 'ramp';
    case 'cardDraw':
      return 'cardDraw';
    case 'removal':
      return 'singleRemoval';
    case 'boardwipe':
      return 'boardWipes';
    default:
      return 'synergy';
  }
}

/**
 * A deck's cards in the dump's buckets: the generator's bucket for every
 * card the dump lists (its analysis reads ramp and lands by bucket), the
 * harness's projection for any other. Copies are matched one by one.
 */
export function categoriesOf(
  deck: ObjectiveDeck,
  decklist: Record<string, Array<{ name: string }>>
): Record<DeckCategory, ScryfallCard[]> {
  const bucketFor = new Map<string, string[]>();
  for (const [bucket, cards] of Object.entries(decklist))
    for (const c of cards)
      (bucketFor.get(c.name) ?? bucketFor.set(c.name, []).get(c.name)!).push(bucket);
  const out = {} as Record<DeckCategory, ScryfallCard[]>;
  for (const c of deck.cards) {
    const bucket = (bucketFor.get(c.name)?.shift() as DeckCategory | undefined) ?? bucketOf(c);
    (out[bucket] ??= []).push(c);
  }
  return out;
}

export interface RewriteExtras {
  /** The generator's deck the search started from (for the report's deltas). */
  seed?: ObjectiveDeck;
  /** The EDHREC page the deck was built from, as the client returns it (for the grade). */
  edhrecData?: EDHRECCommanderData | null;
}

export function rewriteDump(
  base: Dump,
  result: Pick<OptimizeResult, 'deck' | 'swaps' | 'score' | 'seedScore' | 'stoppedBy' | 'ms'> &
    Partial<Pick<OptimizeResult, 'undone'>>,
  ctx: ObjectiveContext,
  extras: RewriteExtras = {}
): Dump {
  const dump = structuredClone(base) as Dump;
  const outs = result.swaps.flatMap((s) => s.out);
  const ins = result.swaps.flatMap((s) => s.in);
  const fullByName = new Map(result.deck.cards.map((c) => [c.name, c]));

  // Decklist: drop one copy per swapped-out card, add each swapped-in card
  // (a card swapped in and later out again never shows).
  const pendingOut = [...outs];
  const decklist: Record<string, Array<DumpCard & Record<string, unknown>>> = {};
  for (const [bucket, cards] of Object.entries(dump.decklist)) {
    decklist[bucket] = [];
    for (const c of cards) {
      const i = pendingOut.indexOf(c.name);
      if (i >= 0) pendingOut.splice(i, 1);
      else decklist[bucket].push(c as DumpCard & Record<string, unknown>);
    }
  }
  const finalNames = result.deck.cards.map((c) => c.name);
  const need = new Map<string, number>();
  for (const n of finalNames) need.set(n, (need.get(n) ?? 0) + 1);
  for (const cards of Object.values(decklist))
    for (const c of cards) need.set(c.name, (need.get(c.name) ?? 0) - 1);
  for (const [name, n] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    for (let k = 0; k < n; k++) {
      const card = fullByName.get(name)!;
      const bucket = bucketOf(card);
      (decklist[bucket] ??= []).push(projectCard(card, ctx));
    }
  }
  dump.decklist = decklist;

  // The card-derived fields, recomputed from the new list.
  const categories = {} as Record<DeckCategory, ScryfallCard[]>;
  for (const [bucket, cards] of Object.entries(decklist)) {
    categories[bucket as DeckCategory] = cards.map((c) => fullByName.get(c.name)!).filter(Boolean);
  }
  const lands = categories.lands ?? [];
  const nonLand = Object.entries(categories)
    .filter(([b]) => b !== 'lands')
    .flatMap(([, cards]) => cards);
  const roles = computeRoleCounts(nonLand);
  const roleCardNames: Record<string, string[]> = {};
  for (const c of nonLand) {
    const r = countedRoleOf(c);
    if (r) (roleCardNames[r] ??= []).push(c.name);
  }
  const stats = calculateStats(categories);
  const price = [...lands, ...nonLand].reduce(
    (s, c) => s + (parseFloat(getCardPrice(c, 'USD') ?? '') || 0),
    0
  );
  const inDeck = new Set([...finalNames, ...result.deck.commanders.map((c) => c.name)]);
  const combos = ((dump.detectedCombos as DetectedCombo[] | null) ?? []).map((c) => {
    const missing = c.cards.filter((n) => !inDeck.has(n));
    return { ...c, isComplete: missing.length === 0, missingCards: missing };
  });
  const manabase = buildManabaseSummary(lands, nonLand, new Set(dump.colorIdentity));
  const bracket = estimateBracket(
    [...result.deck.commanders.map((c) => c.name), ...finalNames],
    combos.filter((c) => c.isComplete),
    stats.averageCmc,
    undefined,
    roles.roleCounts,
    gameChangerNamesFor(result.deck, ctx),
    result.deck.commanders.map((c) => c.name)
  );

  dump.stats = {
    totalCards: stats.totalCards,
    manaCurve: stats.manaCurve,
    typeDistribution: stats.typeDistribution,
    colorDistribution: stats.colorDistribution,
    averageCmc: stats.averageCmc,
    totalPriceUsd: Math.round(price * 100) / 100,
  };
  dump.roleCounts = roles.roleCounts;
  dump.roleCardNames = roleCardNames;
  dump.manabase = manabase;
  dump.detectedCombos = combos;
  dump.bracketEstimation = bracket;

  // Per-card side tables: drop what left, add what came in.
  const relevancy = { ...((dump.cardRelevancy as Record<string, unknown>) ?? {}) };
  for (const n of outs) if (!inDeck.has(n)) delete relevancy[n];
  for (const n of ins)
    if (inDeck.has(n))
      relevancy[n] = { edhrecInclusionPct: getByCardName(ctx.edhrec, n)?.inclusion ?? undefined };
  dump.cardRelevancy = relevancy;
  if (Array.isArray(dump.gapAnalysis)) {
    dump.gapAnalysis = (dump.gapAnalysis as Array<{ name: string }>).filter(
      (g) => !inDeck.has(g.name)
    );
  }

  const report = { ...((dump.buildReport as Record<string, unknown>) ?? {}) };
  report.protectionCount = countProtectionPieces(nonLand);
  report.manabase = manabase;
  report.estimatedBracket = bracket.bracket;
  const provenance = { ...((report.cardProvenance as Record<string, string>) ?? {}) };
  for (const s of result.swaps) {
    for (const n of s.out) if (!inDeck.has(n)) delete provenance[n];
    for (const n of s.in) {
      if (inDeck.has(n)) provenance[n] = `Swapped in by the whole-deck search: ${s.summary}`;
    }
  }
  report.cardProvenance = provenance;
  if (Array.isArray(report.coherenceFindings)) {
    report.coherenceFindings = (report.coherenceFindings as Array<{ card?: string }>).filter(
      (f) => !f.card || inDeck.has(f.card)
    );
  }
  report.optimizerSwaps = result.swaps.map((s) => ({
    out: s.out,
    in: s.in,
    kind: s.kind,
    delta: Math.round(s.delta * 100) / 100,
    terms: Object.fromEntries(
      Object.entries(s.terms)
        .filter(([, v]) => Math.abs(v) >= 0.005)
        .map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    reasons: s.reasons
      .slice(0, 6)
      .map(
        (r) => `${r.name} (${r.term} ${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}): ${r.note}`
      ),
  }));
  dump.buildReport = report;
  if (extras.seed) {
    const inSeed = new Set([...extras.seed.commanders, ...extras.seed.cards].map((c) => c.name));
    const baseCombos = ((base.detectedCombos as DetectedCombo[] | null) ?? []).map((c) => ({
      ...c,
      isComplete: c.cards.every((n) => inSeed.has(n)),
    }));
    refreshReport(
      dump,
      {
        base: extras.seed,
        final: result.deck,
        baseCategories: categoriesOf(extras.seed, base.decklist),
        finalCategories: categories,
        baseCombos,
        finalCombos: combos,
        edhrecData: extras.edhrecData ?? null,
      },
      ctx
    );
  }

  const note =
    result.swaps.length === 0
      ? 'A whole-deck search checked this deck after generation and found no swap worth making.'
      : `After generation, a whole-deck search made ${result.swaps.length} swap${result.swaps.length === 1 ? '' : 's'}: ` +
        result.swaps.map((s) => `${s.in.join(' + ')} for ${s.out.join(' + ')}`).join('; ') +
        (extras.seed
          ? `. The counts, combos, findings and grade describe the deck after these swaps; notes on how it was generated describe the generator's choices. buildReport.optimizerSwaps gives each swap's reasons.`
          : `. The other notes describe the generated deck before these swaps; buildReport.optimizerSwaps gives each swap's reasons.`);
  dump.allNotes = { ...((dump.allNotes as Record<string, string>) ?? {}), optimizerNote: note };
  dump.optimizer = {
    scoreBefore: Math.round(result.seedScore.total * 100) / 100,
    scoreAfter: Math.round(result.score.total * 100) / 100,
    stoppedBy: result.stoppedBy,
    ms: result.ms,
    ...(result.undone?.length ? { undone: result.undone } : {}),
  };
  return dump;
}

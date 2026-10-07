/**
 * Panel dumps in and out of the Coach evaluation (E538).
 *
 * In: a LIVE_GEN panel dump (deckGenerator.live.test.ts) is rebuilt into the
 * deck the Coach reads. Its decklist is a DICT of type-routed buckets, so it
 * is flattened first; each card's 140-character oracle snippet is replaced by
 * the full record (`deckFromDump`), the dump's own printing fields winning.
 *
 * Out: the advised deck is written back in the SAME format, so the ship gate
 * (ship-gate.js, prescan.py) reads it unchanged. Untouched cards keep their
 * original dump rows; a cut leaves its bucket; an added card is projected the
 * way the live harness projects a card and routed to the bucket generation
 * would have put it in (`routeCardByType`). Role counts move by the applied
 * moves only, so an untouched role reads exactly as the original dump does.
 * `appliedCoachMoves` and `coachNote` name every move, so a differ can tell
 * the Coach's edits from generation's.
 */
import type { DeckCategory, DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import {
  drawsOnlyLands,
  getCardTags,
  validateCardRole,
} from '@/deck-builder/services/tagger/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { isBasicLandName } from '@/lib/collection/allocations';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { routeCardByType } from '../categorize';
import { calculateStats } from '../deckStats';
import { buildManabaseSummary } from '../manabaseMath';
import {
  cardFromDump,
  deckFromDump,
  resolveName,
  type DumpCard,
  type PanelDump,
} from '../deckObjective/panelDump';
import type { AppliedMove, EvalDeckState, SkippedMove } from './applyCoachMoves';

/** A panel dump with every other field it carries kept as-is. */
export type CoachDump = PanelDump & Record<string, unknown>;

/** Every card in a decklist dict, one entry per copy, bucket order. */
export function flattenDecklist(decklist: Record<string, DumpCard[]>): DumpCard[] {
  return Object.values(decklist).flat();
}

/** The deck a dump describes, with full card records. Throws on an unknown card. */
export function rebuildDeck(
  dump: PanelDump,
  byName: ReadonlyMap<string, ScryfallCard>
): EvalDeckState {
  const { commanders, cards } = deckFromDump(dump, byName);
  return { commander: commanders[0], partner: commanders[1] ?? null, cards: [...cards] };
}

/**
 * The flags generation stamps on the cards it seats, which a saved generated
 * deck keeps and the Coach reads: `isGameChanger` (the optimizer never cuts
 * one) and `isThemeSynergyCard` (a card from the page's high-synergy, top or
 * Game Changer lists: protected from the excess-role cutter, and a Coach lift
 * seed). A dump doesn't carry them, so they are restored from the Game Changer
 * list and the EDHREC pages the generation read. Copies; the input is untouched.
 */
export function stampGenerationFlags(
  cards: readonly ScryfallCard[],
  gameChangers: ReadonlySet<string>,
  themeSynergyNames: ReadonlySet<string>
): ScryfallCard[] {
  const has = (set: ReadonlySet<string>, name: string) =>
    set.has(name) || set.has(frontFaceName(name));
  return cards.map((c) => {
    const out = { ...c };
    if (has(gameChangers, c.name)) out.isGameChanger = true;
    if (has(themeSynergyNames, c.name)) out.isThemeSynergyCard = true;
    return out;
  });
}

function oracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  return (card.card_faces ?? [])
    .map((f) => f.oracle_text ?? '')
    .filter(Boolean)
    .join(' // ');
}

/** A card as the live harness projects it (deckGenerator.live.test.ts projectCard). */
/** A Coach-added card's role: a land search is not card advantage (T171 round 3). */
function coachRole(card: ScryfallCard): ReturnType<typeof validateCardRole> {
  const role = validateCardRole(card);
  return role === 'cardDraw' && drawsOnlyLands(card.name) ? null : role;
}

export function projectDumpCard(card: ScryfallCard, inclusion: number | null): DumpCard {
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
    oracle_text_snippet: oracleText(card).slice(0, 140),
    edhrec_inclusion: inclusion,
    role: coachRole(card),
    countedRole: countedRoleOf(card),
    tags: getCardTags(card.name),
  } as DumpCard;
}

const EMPTY_BUCKETS = (): Record<DeckCategory, ScryfallCard[]> => ({
  lands: [],
  ramp: [],
  cardDraw: [],
  singleRemoval: [],
  boardWipes: [],
  creatures: [],
  synergy: [],
  utility: [],
});

/** The bucket generation would route `card` to. */
export function bucketFor(card: ScryfallCard): DeckCategory {
  const buckets = EMPTY_BUCKETS();
  routeCardByType(card, buckets);
  return (Object.keys(buckets) as DeckCategory[]).find((k) => buckets[k].length > 0) ?? 'synergy';
}

/** Remove one row named `name` (exact, else by front face) from the buckets. */
function removeRow(decklist: Record<string, DumpCard[]>, name: string): DumpCard | null {
  for (const exact of [true, false]) {
    for (const rows of Object.values(decklist)) {
      const i = rows.findIndex((r) =>
        exact ? r.name === name : frontFaceName(r.name) === frontFaceName(name)
      );
      if (i >= 0) return rows.splice(i, 1)[0];
    }
  }
  return null;
}

const frontTypeLine = (c: ScryfallCard): string =>
  c.card_faces?.[0]?.type_line ?? c.type_line ?? '';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CoachChecks {
  totalCards: number;
  expectedCards: number;
  duplicates: string[];
  offIdentity: string[];
  /** The deck's budget ask, with the priced total and every unpriced card. */
  budget: {
    deckBudget: number | null;
    totalPriceUsd: number;
    over: boolean;
    unpriced: string[];
  };
}

/** Size, singleton, identity and budget over the advised decklist. */
export function coachChecks(dump: PanelDump): CoachChecks {
  const rows = flattenDecklist(dump.decklist);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const identity = new Set(dump.colorIdentity);
  const deckBudget =
    ((dump.customization as Record<string, unknown> | undefined)?.deckBudget as number | null) ??
    null;
  const totalPriceUsd = round2(rows.reduce((s, r) => s + (Number(r.price_usd ?? 0) || 0), 0));
  const unpriced = rows
    .filter((r) => r.price_usd == null && !isBasicLandName(r.name))
    .map((r) => r.name);
  return {
    totalCards: rows.length,
    expectedCards: 99 - (dump.partner ? 1 : 0),
    duplicates: [...counts].filter(([n, c]) => c > 1 && !isBasicLandName(n)).map(([n]) => n),
    offIdentity: rows
      .filter((r) => (r.color_identity ?? []).some((c) => !identity.has(c)))
      .map((r) => r.name),
    budget: {
      deckBudget,
      totalPriceUsd,
      over: deckBudget != null && (totalPriceUsd > deckBudget || unpriced.length > 0),
      unpriced,
    },
  };
}

export interface AdvisedExtras {
  applied: AppliedMove[];
  skipped: SkippedMove[];
  /** EDHREC inclusion % for an added card, null when the page doesn't list it. */
  inclusionOf(name: string): number | null;
  /** Name → full card, for an added card a later move cut again. */
  resolve?(name: string): ScryfallCard | undefined;
  /** Fields recomputed on the advised deck (the second Coach pass). */
  bracketEstimation?: unknown;
  deckGrade?: unknown;
  gapAnalysis?: unknown;
  detectedCombos?: DetectedCombo[];
}

function describe(a: AppliedMove): string {
  if (a.added && a.cut) return `${a.cut} -> ${a.added}`;
  if (a.added) return `+${a.added}`;
  return `-${a.cut}`;
}

/**
 * The original dump with the applied moves made. Pure: `original` is not
 * mutated. `byName` resolves the original rows to full cards for the stats.
 */
export function advisedDump(
  original: CoachDump,
  byName: ReadonlyMap<string, ScryfallCard>,
  final: EvalDeckState,
  extras: AdvisedExtras
): CoachDump {
  const decklist: Record<string, DumpCard[]> = {};
  for (const [k, rows] of Object.entries(original.decklist)) decklist[k] = rows.map((r) => r);

  const roleCounts = { ...((original.roleCounts as Record<string, number> | null) ?? {}) };
  const roleCardNames: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(
    (original.roleCardNames as Record<string, string[]> | null) ?? {}
  )) {
    roleCardNames[k] = [...v];
  }
  let priceDelta = 0;

  for (const a of extras.applied) {
    if (a.cut) {
      const row = removeRow(decklist, a.cut);
      if (!row) throw new Error(`advisedDump: ${a.cut} is not in the decklist`);
      priceDelta -= Number(row.price_usd ?? 0) || 0;
      const full = resolveName(byName, row.name);
      const role = full ? countedRoleOf(full) : null;
      if (role) {
        roleCounts[role] = (roleCounts[role] ?? 0) - 1;
        const names = roleCardNames[role] ?? [];
        const i = names.indexOf(row.name);
        if (i >= 0) names.splice(i, 1);
      }
    }
    if (a.added) {
      const card = final.cards.find((c) => c.name === a.added) ?? extras.resolve?.(a.added);
      if (!card) throw new Error(`advisedDump: ${a.added} is not in the final deck`);
      const bucket = bucketFor(card);
      (decklist[bucket] ??= []).push(projectDumpCard(card, extras.inclusionOf(card.name)));
      priceDelta += Number(getCardPrice(card, 'USD') ?? 0) || 0;
      const role = countedRoleOf(card);
      if (role) {
        roleCounts[role] = (roleCounts[role] ?? 0) + 1;
        (roleCardNames[role] ??= []).push(card.name);
      }
    }
  }

  // Stats over the advised buckets, the generator's own calculator.
  const categories = EMPTY_BUCKETS();
  for (const [k, rows] of Object.entries(decklist)) {
    const key = k as DeckCategory;
    if (!categories[key]) continue;
    for (const r of rows) {
      const full =
        resolveName(byName, r.name) ??
        final.cards.find((c) => c.name === r.name) ??
        extras.resolve?.(r.name);
      if (full) categories[key].push(cardFromDump(r, full));
    }
  }
  const stats = calculateStats(categories);
  const originalStats = (original.stats as Record<string, unknown> | undefined) ?? {};
  const originalPrice = Number(originalStats.totalPriceUsd ?? 0) || 0;

  const cardRelevancy = {
    ...((original.cardRelevancy as Record<string, unknown> | undefined) ?? {}),
  };
  for (const a of extras.applied) {
    if (a.added) cardRelevancy[a.added] = { edhrecInclusionPct: extras.inclusionOf(a.added) };
  }

  const appliedCoachMoves = extras.applied.map((a) => ({
    order: a.order,
    coachRank: a.move.rank,
    source: a.move.source,
    surface: a.move.surface,
    type: a.move.type,
    tier: a.move.tier ?? null,
    added: a.added ?? null,
    cut: a.cut ?? null,
    cutSource: a.cutSource ?? null,
    reason: a.move.reason ?? null,
    cutReason: a.cutReason ?? null,
  }));
  const coachNote =
    extras.applied.length > 0
      ? `After generation, ${extras.applied.length} Coach move${extras.applied.length === 1 ? ' was' : 's were'} applied in Coach order: ${extras.applied.map(describe).join('; ')}. Generation notes above describe the deck before these edits.`
      : 'Coach offered no move this deck could take under its settings; the deck is unedited.';

  const out: CoachDump = {
    ...original,
    decklist,
    roleCounts,
    roleCardNames,
    stats: {
      ...originalStats,
      totalCards: flattenDecklist(decklist).length,
      manaCurve: stats.manaCurve,
      typeDistribution: stats.typeDistribution,
      colorDistribution: stats.colorDistribution,
      averageCmc: round2(stats.averageCmc),
      totalPriceUsd: round2(originalPrice + priceDelta),
    },
    // The generator's own manabase report, over the advised deck.
    manabase: buildManabaseSummary(
      final.cards.filter((c) => /\bland\b/i.test(frontTypeLine(c))),
      final.cards.filter((c) => !/\bland\b/i.test(frontTypeLine(c))),
      new Set(original.colorIdentity)
    ),
    cardRelevancy,
    allNotes: {
      ...((original.allNotes as Record<string, string> | undefined) ?? {}),
      coachNote,
    },
    coachNote,
    appliedCoachMoves,
    skippedCoachMoves: extras.skipped.map((s) => ({
      coachRank: s.move.rank,
      surface: s.move.surface,
      type: s.move.type,
      name: s.move.name,
      outName: s.move.outName ?? null,
      violations: s.violations,
    })),
  };
  if (extras.bracketEstimation !== undefined) out.bracketEstimation = extras.bracketEstimation;
  if (extras.deckGrade !== undefined) out.deckGrade = extras.deckGrade;
  if (extras.gapAnalysis !== undefined) out.gapAnalysis = extras.gapAnalysis;
  if (extras.detectedCombos !== undefined) out.detectedCombos = extras.detectedCombos;
  out.coachChecks = coachChecks(out);
  return out;
}

/** The role numbers one source gives a deck: counts, targets and the cards counted. */
export interface RoleStamp {
  counts: Record<string, number>;
  targets: Record<string, number>;
  names: Record<string, string[]>;
}

/**
 * A dump whose role numbers are one source's. A generated dump carries the
 * generator's counts and targets and its own grade; Coach's analysis recounts the
 * saved deck and grades from its own targets. Both read one plan now (E573: the
 * build plan and the whole-mainboard recount), so the two agree on a deck the
 * generator just built; a dump from before that carried the old disagreement
 * (an MDFC spell-land such as Fell the Profane // Fell Mire a land to the
 * generator and a removal spell to the analysis, ramp target 15 against 14).
 * Putting the analysis' grade beside the generator's counts printed "Removal:
 * running 11" next to roleCounts.removal 10 (T171 S6 round 2). The Cuts-lane gate
 * stamps BOTH sides from the analysis, so before and after are measured by one
 * ruler.
 */
export function restampRoles(dump: CoachDump, roles: RoleStamp, deckGrade: unknown): CoachDump {
  return {
    ...dump,
    roleCounts: roles.counts,
    roleTargets: roles.targets,
    roleCardNames: roles.names,
    ...(deckGrade !== undefined ? { deckGrade } : {}),
  };
}

const TRIM_ROLE: Record<string, string> = {
  Ramp: 'ramp',
  Removal: 'removal',
  'Board wipes': 'boardwipe',
  'Card advantage': 'cardDraw',
};

/** The role trims the grade states ("running 11, only need 8") that its dump's own counts and targets contradict. */
export function gradeTrimDisagreements(dump: CoachDump): string[] {
  const grade = dump.deckGrade as { trims?: { label: string; text: string }[] } | undefined;
  const counts = (dump.roleCounts ?? {}) as Record<string, number>;
  const targets = (dump.roleTargets ?? {}) as Record<string, number>;
  const out: string[] = [];
  for (const t of grade?.trims ?? []) {
    const role = TRIM_ROLE[t.label];
    const m = t.text.match(/running (\d+), only need (\d+)/);
    if (!role || !m) continue;
    if (Number(m[1]) !== counts[role] || Number(m[2]) !== targets[role])
      out.push(`${t.label}: grade says ${m[1]}/${m[2]}, dump has ${counts[role]}/${targets[role]}`);
  }
  return out;
}

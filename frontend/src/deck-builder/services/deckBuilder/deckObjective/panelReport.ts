/**
 * The report half of writing an optimized deck back as a panel dump
 * (panelRewrite.ts): every field that describes the deck says what is true
 * of the FINAL list. The first optimizer gate counted a stale field as a
 * trust issue in 11 of 15 decks ("No stack interaction" beside three
 * counterspells, a repair that "cut" a card the search put back, a nulled
 * grade), so a field is either recomputed or, where only the generator could
 * compute it, kept only while it is still true:
 *
 * - RECOMPUTED with the generator's own functions, as a delta: the same
 *   computation runs on the generator's deck and on the final deck, and the
 *   dump's value moves by the difference. What the offline harness can't
 *   reproduce exactly (the generator's lift map, its full inclusion index)
 *   cancels out, and a deck the search left alone reads exactly as it did.
 *   deckScore, deckGrade (its letter moved by the steps the harness's grade
 *   moved), coherenceFindings, roleGaps and roleExcesses.
 * - FILTERED: the generation's record of what it cut and added (coherence
 *   and budget repairs, surplus conversions, flagship seatings, fix-ups,
 *   synergy fills, package picks, combo completions) keeps an entry only
 *   while the final deck still has what it added and not what it cut.
 * - UPDATED: the budget note's total.
 * - DROPPED when the search changed what they count: the role-cap overflow
 *   and wipe asymmetry notes (the counts they explain are not the deck's).
 */
import type {
  DeckCategory,
  DetectedCombo,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import {
  buildInclusionIndex,
  computeGradeAndBracket,
  computeRoleCounts,
  lookupInclusion,
} from '../commanderDeckAnalysis';
import { auditDeckCoherence } from '../coherenceAudit';
import { calculateStats } from '../deckStats';
import { isRoleExcess } from '../deckAnalyzer';
import { buildManabaseSummary } from '../manabaseMath';
import { gameChangerNamesFor } from './constraints';
import { isBasicLand, isLandCard } from './context';
import type { ObjectiveContext, ObjectiveDeck } from './types';

type Report = Record<string, unknown>;

interface Analysis {
  deckScore: number | null;
  grade: { letter: string; headline: string; trims?: unknown } | null;
  findings: Array<{ kind: string; message: string; card?: string }>;
  roleCounts: Record<string, number>;
}

/** The generator's analysis of a card list, as far as the harness can run it (exported for the harness's check). */
export function analyseDeck(
  deck: ObjectiveDeck,
  categories: Record<DeckCategory, ScryfallCard[]>,
  ctx: ObjectiveContext,
  dump: Report,
  edhrecData: EDHRECCommanderData | null,
  combos: DetectedCombo[]
): Analysis {
  const lands = categories.lands ?? [];
  const nonLand = deck.cards.filter((c) => !isLandCard(c));
  const { roleCounts } = computeRoleCounts(nonLand);
  const stats = calculateStats(categories);
  const index = edhrecData ? buildInclusionIndex(edhrecData) : null;
  const inclusion: Record<string, number> = {};
  let score = 0;
  for (const c of deck.cards) {
    if (isBasicLand(c) || !index) continue;
    const v = lookupInclusion(index, c.name) ?? 0;
    inclusion[c.name] = v;
    score += v;
  }
  const commanders = [...deck.commanders];
  const complete = combos.filter((c) => c.isComplete);
  const roleTargets = (dump.roleTargets as Record<string, number> | undefined) ?? null;
  const cz = (dump.customization as { deckFormat?: number; landCount?: number }) ?? {};
  let grade: Analysis['grade'] = null;
  if (edhrecData && roleTargets) {
    const r = computeGradeAndBracket({
      allCardNames: [...commanders, ...deck.cards].map((c) => c.name),
      detectedCombos: complete,
      averageCmc: stats.averageCmc,
      deckScore: index ? Math.round(score) : undefined,
      bracketRoleCounts: roleCounts,
      gameChangerNames: gameChangerNamesFor(deck, ctx),
      commanderNames: commanders.map((c) => c.name),
      allCards: Object.values(categories).flat(),
      roleCounts,
      roleTargets,
      edhrecData,
      deckSize: cz.deckFormat ?? 99,
      cardInclusionMap: index ? inclusion : undefined,
      colorIdentity: [...ctx.colorIdentity],
      // The generator grades against the land count it built to.
      overrideLandTarget: cz.landCount ?? lands.length,
      overridePacing: ctx.pacing,
    });
    grade = r.deckGrade
      ? { letter: r.deckGrade.letter, headline: r.deckGrade.headline, trims: r.deckGrade.trims }
      : null;
  }
  const manabase = buildManabaseSummary(lands, nonLand, new Set(ctx.colorIdentity));
  const findings = auditDeckCoherence({
    nonLandCards: nonLand,
    commanders,
    cardInclusionMap: index ? inclusion : undefined,
    detectedCombos: complete,
    roleOf: getCardRole,
    lands,
    manabase,
    format: 'commander',
    colorIdentity: [...ctx.colorIdentity],
  });
  return { deckScore: index ? score : null, grade, findings, roleCounts };
}

const LETTERS = ['A', 'B', 'C', 'D', 'F'];

const findingKey = (f: { kind: string; message: string; card?: string }) =>
  `${f.kind}|${f.card ?? ''}|${f.message}`;

export interface ReportRefresh {
  base: ObjectiveDeck;
  final: ObjectiveDeck;
  baseCategories: Record<DeckCategory, ScryfallCard[]>;
  finalCategories: Record<DeckCategory, ScryfallCard[]>;
  baseCombos: DetectedCombo[];
  finalCombos: DetectedCombo[];
  edhrecData: EDHRECCommanderData | null;
}

/** Bring the dump's deck-describing fields up to the final deck. Mutates `dump`. */
export function refreshReport(dump: Report, r: ReportRefresh, ctx: ObjectiveContext): void {
  const report = (dump.buildReport as Report) ?? {};
  const notes = (dump.allNotes as Record<string, string>) ?? {};
  const inFinal = new Set([...r.final.commanders, ...r.final.cards].map((c) => c.name));
  const inBase = new Set([...r.base.commanders, ...r.base.cards].map((c) => c.name));
  const changed = [...inFinal].some((n) => !inBase.has(n));
  const a = analyseDeck(r.base, r.baseCategories, ctx, dump, r.edhrecData, r.baseCombos);
  const b = analyseDeck(r.final, r.finalCategories, ctx, dump, r.edhrecData, r.finalCombos);

  // Scores and grade, as deltas over what the generator reported.
  if (typeof dump.deckScore === 'number' && a.deckScore !== null && b.deckScore !== null) {
    dump.deckScore = Math.round((dump.deckScore as number) + b.deckScore - a.deckScore);
  }
  // The grade, as a delta too: the letter moves as many steps as the
  // harness's own grade moved between the two decks. The harness reproduces
  // the generator's letter for 9 of the 15 standard decks and reads one step
  // lower (on the mana grade) for the other 6, a gap not yet traced, so the
  // letter is never taken from it directly. Headline and trims are the final
  // deck's.
  const graded = dump.deckGrade as { letter?: string } | null;
  if (graded?.letter && a.grade && b.grade) {
    const step = LETTERS.indexOf(b.grade.letter) - LETTERS.indexOf(a.grade.letter);
    const at = LETTERS.indexOf(graded.letter) + step;
    const letter = LETTERS[Math.max(0, Math.min(LETTERS.length - 1, at))];
    dump.deckGrade = { ...b.grade, letter };
  }

  // Coherence findings: the generator's list, minus what the swaps resolved,
  // plus what they caused.
  if (changed) {
    const before = new Set(a.findings.map(findingKey));
    const after = new Set(b.findings.map(findingKey));
    const kept = ((report.coherenceFindings as Analysis['findings']) ?? []).filter(
      (f) => !before.has(findingKey(f)) || after.has(findingKey(f))
    );
    const added = b.findings.filter((f) => !before.has(findingKey(f)));
    const findings = [...kept, ...added].filter((f) => !f.card || inFinal.has(f.card));
    if (findings.length) report.coherenceFindings = findings;
    else delete report.coherenceFindings;
  }

  // Role gaps and excesses, from the final counts.
  const targets = (dump.roleTargets as Record<string, number> | undefined) ?? {};
  const gaps: Array<{ role: string; have: number; want: number }> = [];
  const excesses: Array<{ role: string; have: number; want: number }> = [];
  for (const [role, want] of Object.entries(targets)) {
    const have = b.roleCounts[role] ?? 0;
    if (have < want) gaps.push({ role, have, want });
    else if (isRoleExcess(have, want)) excesses.push({ role, have, want });
  }
  if (gaps.length) report.roleGaps = gaps;
  else delete report.roleGaps;
  if (excesses.length) report.roleExcesses = excesses;
  else delete report.roleExcesses;

  // The generation's record of what it did: an entry stays while it is true.
  const stillTrue = (e: { cut?: string; added?: string }) =>
    (!e.added || inFinal.has(e.added)) && (!e.cut || !inFinal.has(e.cut));
  for (const k of [
    'coherenceRepairs',
    'budgetRepairs',
    'surplusConversions',
    'flagshipSeatings',
    'fixupRepairs',
  ]) {
    if (!Array.isArray(report[k])) continue;
    const list = (report[k] as Array<{ cut?: string; added?: string }>).filter(stillTrue);
    if (list.length) report[k] = list;
    else delete report[k];
  }
  for (const k of ['synergyFills', 'packagePicks']) {
    for (const holder of [report, dump]) {
      if (!Array.isArray(holder[k])) continue;
      const list = (holder[k] as Array<{ name: string }>).filter((e) => inFinal.has(e.name));
      if (list.length) holder[k] = list;
      else delete holder[k];
    }
  }
  if (Array.isArray(report.comboCompletionNotes)) {
    const inDeckKey = new Set([...inFinal].flatMap((n) => [n, n.split(' // ')[0]]));
    report.comboCompletionNotes = (report.comboCompletionNotes as string[]).filter((line) =>
      line
        .split(': ')[0]
        .split(' + ')
        .every((n) => inDeckKey.has(n))
    );
  }

  // Notes that count what the search changed.
  const roleMoved = Object.keys(targets).some(
    (role) => (a.roleCounts[role] ?? 0) !== (b.roleCounts[role] ?? 0)
  );
  const wipesMoved = (a.roleCounts.boardwipe ?? 0) !== (b.roleCounts.boardwipe ?? 0);
  for (const [k, drop] of [
    ['roleCapOverflowNote', roleMoved],
    ['wipeAsymmetryNote', wipesMoved],
  ] as const) {
    if (!drop) continue;
    delete report[k];
    delete notes[k];
  }
  const cz = (dump.customization as { currency?: 'USD' | 'EUR' }) ?? {};
  const total = r.final.cards.reduce(
    (s, c) => s + (parseFloat(getCardPrice(c, cz.currency ?? 'USD') ?? '') || 0),
    0
  );
  for (const holder of [report, notes]) {
    if (typeof holder.budgetNote === 'string') {
      holder.budgetNote = (holder.budgetNote as string).replace(
        /Deck totals [$€]?[\d,.]+/,
        (m) => `Deck totals ${m.includes('€') ? '€' : '$'}${total.toFixed(2)}`
      );
    }
  }
  dump.buildReport = report;
  dump.allNotes = notes;
}

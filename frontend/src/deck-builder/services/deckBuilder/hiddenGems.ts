/**
 * Hidden-gems engine (E146) — underrated-card discovery for the deck editor's
 * Suggestions tab. Surfaces cards EDHREC's inclusion ranking does NOT
 * recommend for this commander (low or no inclusion on its page, never
 * overlapping the gapAnalysis staples) but that at least one validated
 * popularity-independent signal vouches for:
 *
 *   • lift    — EDHREC card-page co-play lift to ≥2 of the deck's lift seeds
 *               (E71 clusterScore; see liftSynergy.ts buildLiftIndex)
 *   • similar — a close functional substitute (card-similar snapshot, the
 *               substituteFinder's validated primary signal) of a card
 *               already in the deck
 *   • axis    — completes the scarcer side of a live producer/payoff engine
 *               (packageBoost's oracle-text classifier)
 *
 * Suggestions only — nothing here mutates a deck or the generator's pick
 * order. Rows are lean and persistable (names + primitives, like
 * GapAnalysisCard); ownership is marked later by the UI against the live
 * collection. The card resolver and similar-rank lookup are injected so the
 * engine stays pure and unit-testable.
 */
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { HiddenGemRow, HiddenGemSignal } from '@/deck-builder/types';
import { isBasicLandName } from '@/lib/allocations';
import { frontFaceName } from '@/lib/card-text';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { fitsColorIdentity, notCommanderLegal } from './deckFilters';
import { tallyAxisInvestment, packageFitAxes } from './packageBoost';
import { AXES } from '@/deck-builder/services/synergy/axes';

/** A card at/above this EDHREC inclusion % is a staple, not a hidden gem. */
export const GEM_INCLUSION_CEILING = 10;
/** Lift evidence requires this many distinct seed connections (mirrors the
 *  optimizer's "2+-link cluster is structural" criterion). */
const LIFT_MIN_SEEDS = 2;
/** How deep into a deck card's similar list still counts as "plays like it". */
const SIMILAR_MAX_RANK = 4;
/** Axis fit below this boost is too weak to cite as evidence on its own. */
const AXIS_MIN_BOOST = 8;
/** Per-source candidate caps before the single batched card fetch. */
const LIFT_CAP = 20;
const SIMILAR_CAP = 20;
const TAIL_CAP = 20;
/** Final row cap — the lane must stay scannable. */
export const MAX_GEMS = 10;

const AXIS_LABELS = new Map(AXES.map((a) => [a.key, a.label]));

export interface ComputeHiddenGemsOptions {
  /** All cards currently in the deck (the 99), commanders separate. */
  deckCards: readonly ScryfallCard[];
  commanders: readonly ScryfallCard[];
  colorIdentity: string[];
  edhrecData: EDHRECCommanderData;
  /** Names already suggested by gapAnalysis — gems never duplicate staples. */
  gapNames: readonly string[];
  /** Lift index from the analysis' seed pools (lowercased keys). Optional —
   *  without it the lift signal simply contributes nothing. */
  liftIndex?: Map<string, { clusterScore: number; liftedBy: string[] }>;
  /** Similar-rank lookup for a deck card (cardSimilar.getSimilarRank). */
  similarRankFor?: (name: string) => ReadonlyMap<string, number> | null;
  /** Batched name → card resolver (scryfall client getCardsByNames). */
  resolveCards: (names: string[]) => Promise<Map<string, ScryfallCard>>;
}

interface Candidate {
  name: string;
  signals: { signal: HiddenGemSignal; strength: number }[];
}

/** EDHREC ships TCGplayer/Cardkingdom prices; first available as a 2dp string. */
function edhrecPrice(card: EDHRECCard): string | null {
  if (card.prices?.tcgplayer?.price) return card.prices.tcgplayer.price.toFixed(2);
  if (card.prices?.cardkingdom?.price) return card.prices.cardkingdom.price.toFixed(2);
  return null;
}

/** Bounded cross-kind strength so the three signals sort on one scale. */
function signalStrength(kind: HiddenGemSignal['kind'], raw: number): number {
  if (kind === 'lift') return Math.min(90, raw); // raw = clusterScore
  if (kind === 'similar') return 90 - 20 * raw; // raw = rank 0..4 → 90..10
  return raw * 3; // raw = axis boost 8..20 → 24..60
}

function addSignal(
  candidates: Map<string, Candidate>,
  name: string,
  signal: HiddenGemSignal,
  strength: number
): void {
  const key = name.toLowerCase();
  const existing = candidates.get(key);
  if (!existing) {
    candidates.set(key, { name, signals: [{ signal, strength }] });
  } else if (!existing.signals.some((s) => s.signal.kind === signal.kind)) {
    existing.signals.push({ signal, strength });
  }
}

/**
 * The evidence copy for one signal — fixed vocabulary (see STYLE_GUIDE
 * "Voice & copy"): lift reuses the E71 phrasing verbatim; similar and axis
 * are this lane's additions to the vocabulary. Combine with ` · `.
 */
export function hiddenGemSignalCopy(signal: HiddenGemSignal): string {
  if (signal.kind === 'lift') return `Lifted by ${signal.names.join(', ')}`;
  if (signal.kind === 'similar') return `Plays like ${signal.names[0]}`;
  return `Completes your ${signal.names[0]} engine`;
}

/** Full mid-dot-combined reason line for a row, strongest signal first. */
export function hiddenGemReason(row: { signals: HiddenGemSignal[] }): string {
  return row.signals.map(hiddenGemSignalCopy).join(' · ');
}

export async function computeHiddenGems(opts: ComputeHiddenGemsOptions): Promise<HiddenGemRow[]> {
  const {
    deckCards,
    commanders,
    colorIdentity,
    edhrecData,
    gapNames,
    liftIndex,
    similarRankFor,
    resolveCards,
  } = opts;

  // Names that can never be gems: everything in the deck (front faces too,
  // EDHREC/similar lists use front-face names) and the gapAnalysis staples.
  const excluded = new Set<string>();
  for (const card of [...deckCards, ...commanders]) {
    excluded.add(card.name.toLowerCase());
    if (card.name.includes(' // ')) excluded.add(frontFaceName(card.name).toLowerCase());
  }
  for (const name of gapNames) excluded.add(name.toLowerCase());

  const edhrecByLower = new Map<string, EDHRECCard>(
    edhrecData.cardlists.allNonLand.map((c) => [c.name.toLowerCase(), c])
  );
  const inclusionOf = (name: string): number | undefined =>
    edhrecByLower.get(name.toLowerCase())?.inclusion;
  const tooPopular = (name: string): boolean => (inclusionOf(name) ?? 0) >= GEM_INCLUSION_CEILING;

  const candidates = new Map<string, Candidate>();

  // Signal 1 — lift: multi-seed co-play connectivity (the validated E71 signal).
  if (liftIndex) {
    const lifted = [...liftIndex]
      .filter(
        ([key, entry]) =>
          entry.liftedBy.length >= LIFT_MIN_SEEDS && !excluded.has(key) && !tooPopular(key)
      )
      .sort((a, b) => b[1].clusterScore - a[1].clusterScore)
      .slice(0, LIFT_CAP);
    for (const [key, entry] of lifted) {
      // The index is keyed lowercase; recover display casing from the EDHREC
      // entry when the page knows the card, else from the resolved card later.
      const display = edhrecByLower.get(key)?.name ?? key;
      addSignal(
        candidates,
        display,
        { kind: 'lift', names: entry.liftedBy },
        signalStrength('lift', entry.clusterScore)
      );
    }
  }

  // Signal 2 — similar: close functional substitutes of cards already in the
  // deck (commanders included — "plays like your commander" is real evidence).
  if (similarRankFor) {
    const similarHits: { name: string; likeName: string; rank: number }[] = [];
    for (const deckCard of [...commanders, ...deckCards]) {
      const ranks = similarRankFor(deckCard.name);
      if (!ranks) continue;
      for (const [name, rank] of ranks) {
        if (rank > SIMILAR_MAX_RANK) continue;
        if (excluded.has(name.toLowerCase()) || tooPopular(name)) continue;
        similarHits.push({ name, likeName: deckCard.name, rank });
      }
    }
    similarHits.sort((a, b) => a.rank - b.rank);
    for (const hit of similarHits.slice(0, SIMILAR_CAP)) {
      addSignal(
        candidates,
        hit.name,
        { kind: 'similar', names: [hit.likeName] },
        signalStrength('similar', hit.rank)
      );
    }
  }

  // Axis-only candidate source — the commander page's low-inclusion tail,
  // synergy-leaning first. These earn a row only if the axis check below
  // finds real engine fit; lift/similar candidates get the axis check too,
  // as confirming evidence.
  const tail = edhrecData.cardlists.allNonLand
    .filter(
      (c) =>
        c.inclusion < GEM_INCLUSION_CEILING &&
        (c.synergy ?? 0) > 0 &&
        !excluded.has(c.name.toLowerCase()) &&
        !isBasicLandName(c.name)
    )
    .sort((a, b) => (b.synergy ?? 0) - (a.synergy ?? 0))
    .slice(0, TAIL_CAP);

  const namesToResolve = [
    ...new Set([...candidates.values()].map((c) => c.name).concat(tail.map((c) => c.name))),
  ];
  if (namesToResolve.length === 0) return [];

  const cardMap = await resolveCards(namesToResolve);
  const cardByLower = new Map<string, ScryfallCard>(
    [...cardMap.values()].map((c) => [c.name.toLowerCase(), c])
  );
  const resolvedFor = (name: string): ScryfallCard | undefined =>
    cardMap.get(name) ?? cardByLower.get(name.toLowerCase());

  // Axis fit runs over every resolved candidate (tail AND lift/similar).
  const investment = tallyAxisInvestment(deckCards, commanders);
  for (const name of namesToResolve) {
    const card = resolvedFor(name);
    if (!card) continue;
    const fits = packageFitAxes(card, investment)
      .filter((f) => f.boost >= AXIS_MIN_BOOST)
      .sort((a, b) => b.boost - a.boost);
    if (fits.length === 0) continue;
    const label = AXIS_LABELS.get(fits[0].axis);
    if (!label) continue;
    addSignal(
      candidates,
      card.name,
      { kind: 'axis', names: [label] },
      signalStrength('axis', fits[0].boost)
    );
  }

  // Hard gates on the resolved card, then assemble lean rows.
  const rows: (HiddenGemRow & { score: number })[] = [];
  for (const candidate of candidates.values()) {
    const card = resolvedFor(candidate.name);
    if (!card) continue;
    if (excluded.has(card.name.toLowerCase()) || tooPopular(card.name)) continue;
    if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) continue;
    if (!fitsColorIdentity(card, colorIdentity)) continue;
    if (notCommanderLegal(card)) continue;

    const edhrecEntry = edhrecByLower.get(card.name.toLowerCase());
    const signals = [...candidate.signals].sort((a, b) => b.strength - a.strength);
    rows.push({
      name: card.name,
      typeLine: getFrontFaceTypeLine(card),
      price: edhrecEntry ? edhrecPrice(edhrecEntry) : (card.prices?.usd ?? null),
      cmc: card.cmc,
      inclusion: edhrecEntry?.inclusion,
      signals: signals.map((s) => s.signal),
      // Multi-signal cards outrank any single-signal card; ties by strength.
      score: 100 * (signals.length - 1) + signals[0].strength,
    });
  }

  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.slice(0, MAX_GEMS).map(({ score: _score, ...row }) => row);
}

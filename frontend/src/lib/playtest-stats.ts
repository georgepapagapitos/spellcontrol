/**
 * Pure stat-computation helpers for the PlaytestStatsSheet.
 *
 * Decoupled from React — each function takes plain data in, returns a plain
 * result out. This makes them trivially unit-testable and keeps them inside the
 * `src/lib/**` coverage gate.
 */

import type { PlaytestCard, BattlefieldCard, PlaytestState } from './playtest';
import type { SimCard } from './opening-hand-sim';
import type { ScryfallCard } from '@/deck-builder/types';
import { toSimCard as scryToSimCard, isLand } from './hand-classify';
import { isPlaytestLand } from '@/playtest/lib/zones';
import { classifyTypeLine } from './build-mana-data';

// ── Output types ──────────────────────────────────────────────────────────────

export interface HandStats {
  lands: number;
  nonLands: number;
  /** Color-identity breakdown, keyed WUBRG / C. */
  colorBreakdown: Record<string, number>;
  /**
   * CMC histogram buckets: indices 0–6 are exact CMC; index 7 is the "7+"
   * open bucket. Lands are excluded (their CMC is 0 but they're mana sources,
   * not spells). Length is always 8.
   */
  cmcBuckets: number[];
}

export interface BattlefieldStats {
  /** Permanent counts by primary type (creature / artifact / enchantment / land / planeswalker / other). */
  permanentsByType: Record<string, number>;
  tapped: number;
  untapped: number;
  tokenCount: number;
  /** Average CMC of non-land, non-token permanents. 0 when none. */
  avgCmc: number;
}

export interface DeckSessionStats {
  turn: number;
  handSize: number;
  mulliganCount: number;
  libraryCount: number;
  graveyardCount: number;
  exileCount: number;
  battlefieldCount: number;
  /** null when deckSize is unknown (deck prop not yet resolved). */
  cardsDrawn: number | null;
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Reduce a PlaytestCard to a SimCard so the hand-sim heuristics can classify it.
 * When the full ScryfallCard is available (via cardLookup), delegates to `toSimCard`
 * for accurate role + color_identity data. Otherwise falls back to the minimal
 * PlaytestCard fields so the caller still gets a result even when lookup data is absent.
 */
export function toHandSimCards(
  hand: PlaytestCard[],
  cardLookup?: Map<string, ScryfallCard>
): SimCard[] {
  return hand.map((c) => {
    const scry = cardLookup?.get(c.id);
    if (scry) return scryToSimCard(scry);
    return {
      isLand: isPlaytestLand(c.typeLine),
      cmc: c.manaValue ?? 0,
      role: null,
      colors: [],
    };
  });
}

/**
 * Compute stats for the current hand.
 *
 * When `cardLookup` is provided, color_identity comes from the full ScryfallCard.
 * When absent, color data is unavailable (colorBreakdown will be empty) but
 * land/CMC counts still work via PlaytestCard fields.
 */
export function computeHandStats(
  hand: PlaytestCard[],
  cardLookup?: Map<string, ScryfallCard>
): HandStats {
  const cmcBuckets = new Array<number>(8).fill(0);
  const colorBreakdown: Record<string, number> = {};
  let lands = 0;
  let nonLands = 0;

  for (const c of hand) {
    const scry = cardLookup?.get(c.id);
    const isCardLand = scry ? isLand(scry) : isPlaytestLand(c.typeLine);

    if (isCardLand) {
      lands++;
      // Tally color identity from the full card when available.
      if (scry) {
        const colors = scry.color_identity ?? [];
        if (colors.length === 0) {
          colorBreakdown['C'] = (colorBreakdown['C'] ?? 0) + 1;
        } else {
          for (const col of colors) {
            colorBreakdown[col] = (colorBreakdown[col] ?? 0) + 1;
          }
        }
      }
    } else {
      nonLands++;
      const cmc = scry ? (scry.cmc ?? 0) : (c.manaValue ?? 0);
      const bucket = Math.min(7, Math.floor(cmc));
      cmcBuckets[bucket]++;
    }
  }

  return { lands, nonLands, colorBreakdown, cmcBuckets };
}

/**
 * Compute stats for the current battlefield.
 *
 * Tokens (isToken: true) are counted separately and excluded from type/CMC analysis.
 */
export function computeBattlefieldStats(battlefield: BattlefieldCard[]): BattlefieldStats {
  const permanentsByType: Record<string, number> = {};
  let tapped = 0;
  let untapped = 0;
  let tokenCount = 0;
  let cmcSum = 0;
  let cmcCount = 0;

  for (const b of battlefield) {
    if (b.card.isToken) {
      tokenCount++;
      if (b.tapped) tapped++;
      else untapped++;
      continue;
    }

    if (b.tapped) tapped++;
    else untapped++;

    const typeBucket = classifyTypeLine(b.card.typeLine);
    permanentsByType[typeBucket] = (permanentsByType[typeBucket] ?? 0) + 1;

    // Exclude lands from CMC average — they're mana sources, not spells.
    if (!isPlaytestLand(b.card.typeLine)) {
      cmcSum += b.card.manaValue ?? 0;
      cmcCount++;
    }
  }

  return {
    permanentsByType,
    tapped,
    untapped,
    tokenCount,
    avgCmc: cmcCount > 0 ? cmcSum / cmcCount : 0,
  };
}

/**
 * Compute session-level stats from the current game state.
 *
 * `deckSize` is the original deck's card count (from `deck.cards.length`). Pass
 * `null` when the deck hasn't resolved yet — `cardsDrawn` will then be null.
 */
export function computeDeckStats(
  state: PlaytestState,
  deckSize: number | null,
  mulliganCount: number
): DeckSessionStats {
  const handSize = state.zones.hand.length;
  const libraryCount = state.zones.library.length;
  const graveyardCount = state.zones.graveyard.length;
  const exileCount = state.zones.exile.length;
  // Non-token permanents only for the "cards drawn" math (tokens aren't in deck.cards).
  const battlefieldCount = state.battlefield.filter((b) => !b.card.isToken).length;

  const cardsDrawn =
    deckSize !== null
      ? deckSize - libraryCount - handSize - graveyardCount - exileCount - battlefieldCount
      : null;

  return {
    turn: state.turn,
    handSize,
    mulliganCount,
    libraryCount,
    graveyardCount,
    exileCount,
    battlefieldCount,
    cardsDrawn,
  };
}

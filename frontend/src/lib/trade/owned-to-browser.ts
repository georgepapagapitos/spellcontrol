import { computeSpareCopyIds } from '@spellcontrol/binder-routing';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import type { PublicCard } from '@/lib/social/shared-types';
import type { EnrichedCard } from '@/types/index';
import { keyOf } from './trade-basket';
import {
  groupOwnedForTrade,
  matchesPrinting,
  type OwnedTradeLine,
  type PrintingRef,
} from './trade-picker';

/**
 * The viewer's own collection, shaped for the collection browser that
 * otherwise browses a friend's. Only what a trade can move is included
 * (`groupOwnedForTrade`: no proxies, nothing without an oracle id).
 *
 * `spare` and `inDeck` are set per copy, so the browser's own "Spare" and
 * "Not in a deck" chips and tile captions work on this side exactly as they do
 * on a friend's. Unlike a friend's payload these never leave the device, so
 * the deck names ride along in `OwnedInfo` for the confirm dialog.
 */
export interface OwnedInfo {
  line: OwnedTradeLine;
  owned: number;
  /** Copies free to hand over: in no deck or cube, past the one kept. */
  spare: number;
  /** Names of the decks and cubes that claim a copy, deduped, in claim order. */
  holders: string[];
}

export interface OwnedBrowserModel {
  rows: PublicCard[];
  /** By `keyOf`, so the same key the draft uses. */
  info: Map<string, OwnedInfo>;
}

function toRow(card: EnrichedCard, inDeck: boolean, spare: boolean): PublicCard {
  return {
    name: card.name,
    scryfallId: card.scryfallId,
    oracleId: card.oracleId,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    finish: card.finish,
    foil: card.foil,
    condition: card.condition,
    language: card.language,
    altered: card.altered,
    proxy: card.proxy,
    misprint: card.misprint,
    purchasePrice: card.purchasePrice,
    cmc: card.cmc,
    typeLine: card.typeLine,
    colorIdentity: card.colorIdentity,
    colors: card.colors,
    imageSmall: card.imageSmall,
    imageNormal: card.imageNormal,
    imageNormalBack: card.imageNormalBack,
    layout: card.layout,
    manaCost: card.manaCost,
    oracleText: card.oracleText,
    legalities: card.legalities,
    frameEffects: card.frameEffects,
    fullArt: card.fullArt,
    borderColor: card.borderColor,
    edhrecRank: card.edhrecRank,
    inDeck,
    spare,
  };
}

export function buildOwnedBrowser(
  cards: EnrichedCard[],
  allocations: ReadonlyMap<string, AllocationInfo>
): OwnedBrowserModel {
  const spareIds = computeSpareCopyIds(cards, new Set(allocations.keys()));
  const info = new Map<string, OwnedInfo>();
  for (const line of groupOwnedForTrade(cards)) {
    const holders: string[] = [];
    let spare = 0;
    for (const copy of line.copies) {
      const claim = allocations.get(copy.copyId);
      if (claim && !holders.includes(claim.ownerName)) holders.push(claim.ownerName);
      if (spareIds.has(copy.copyId)) spare += 1;
    }
    info.set(keyOf(line), { line, owned: line.copies.length, spare, holders });
  }
  const rows: PublicCard[] = [];
  for (const card of cards) {
    if (card.proxy || !card.oracleId) continue;
    rows.push(toRow(card, allocations.has(card.copyId), spareIds.has(card.copyId)));
  }
  return { rows, info };
}

/** What a tile says about a card the viewer owns, in plain words. */
export function describeOwned(info: OwnedInfo): string {
  if (info.spare > 0) return `${info.spare} spare`;
  if (info.holders.length > 0) {
    return info.holders.length === 1 ? 'in 1 deck' : `in ${info.holders.length} decks`;
  }
  if (info.owned === 1) return 'your only copy';
  return `${info.owned} copies`;
}

/** What one printing's tile can honestly say: its own copies, not the card's. */
export interface PrintingStats {
  owned: number;
  /** Copies of this printing in no deck or cube. */
  free: number;
  /** Decks and cubes that hold a copy of this printing. */
  holders: string[];
  /** copyIds of this printing. */
  copyIds: Set<string>;
}

export function printingStats(
  info: OwnedInfo,
  printing: PrintingRef,
  allocations: ReadonlyMap<string, AllocationInfo>
): PrintingStats {
  const stats: PrintingStats = { owned: 0, free: 0, holders: [], copyIds: new Set() };
  for (const copy of info.line.copies) {
    if (!matchesPrinting(copy, printing)) continue;
    stats.owned += 1;
    stats.copyIds.add(copy.copyId);
    const claim = allocations.get(copy.copyId);
    if (!claim) stats.free += 1;
    else if (!stats.holders.includes(claim.ownerName)) stats.holders.push(claim.ownerName);
  }
  return stats;
}

/**
 * A printing tile's caption. "N spare" never promises more than a "+" on THIS
 * tile can deliver without a warning: the card's spare count is capped at this
 * printing's free copies, since a tap takes this printing's free copy first
 * and only then one a deck holds.
 */
export function describeOwnedPrinting(info: OwnedInfo, stats: PrintingStats): string {
  const spare = Math.min(info.spare, stats.free);
  if (spare > 0) return `${spare} spare`;
  if (stats.free === 0 && stats.holders.length > 0) {
    return stats.holders.length === 1 ? 'in 1 deck' : `in ${stats.holders.length} decks`;
  }
  if (info.owned === 1) return 'your only copy';
  return `${stats.owned} ${stats.owned === 1 ? 'copy' : 'copies'}`;
}

/**
 * The sort the Your cards side opens on: what the friend wants first, and
 * within that the cards that cost nothing to give. Lower sorts first.
 */
export function givePriority(wanted: boolean, spare: boolean): number {
  if (wanted) return spare ? 0 : 1;
  return spare ? 2 : 3;
}

/**
 * Whether giving this copy deserves a second look, and the words for it.
 * A copy a deck or cube holds says so; the only copy of a card says that.
 * Null when the copy is free to go.
 */
export function giveWarning(
  copy: EnrichedCard,
  info: OwnedInfo,
  allocations: ReadonlyMap<string, AllocationInfo>,
  friendName: string
): string | null {
  const claim = allocations.get(copy.copyId);
  if (claim) {
    const kind = claim.ownerKind === 'cube' ? 'cube' : 'deck';
    return `${copy.name} is in ${claim.ownerName}. If ${friendName} accepts, that ${kind} will need another copy.`;
  }
  if (info.owned === 1) {
    return `${copy.name} is your only copy. If ${friendName} accepts, you won't have it any more.`;
  }
  return null;
}

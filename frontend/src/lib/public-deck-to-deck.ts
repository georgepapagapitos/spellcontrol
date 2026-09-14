import type { Deck, DeckCard } from '@/store/decks';
import type {
  ScryfallCard,
  Archetype,
  BuildReport,
  DeckCategory,
  DeckFormat,
} from '@/deck-builder/types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import type { SynergyAnalysis } from '@/deck-builder/services/synergy/analysis';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { PublicDeck } from './shared-types';

/**
 * Turns a public/shared deck payload into the same `Deck` shape the owner's
 * own surfaces consume, so ONE deck view serves both. Before this existed the
 * shared page had a parallel component (`SharedDeckView`) that re-implemented
 * a thinner list and drifted from the real one; now `/d/:slug` and `/s/:token`
 * render `DeckDisplay` — the owner's component — with the edit handlers simply
 * not passed.
 *
 * This is the ONLY place that casts the payload's deliberately-`unknown`
 * analysis blobs into their real types. They arrive from the server having
 * round-tripped through the owner's own store, so the shapes match by
 * construction; the projection (`backend/src/shares/projections.ts`) coerces
 * the primitives and drops malformed tallies before they get here.
 */

/**
 * Namespaced so a visitor's local, deck-id-keyed state (playtest snapshots,
 * session history) can never collide with a deck of their own that happens to
 * share the owner's uuid — or, after copying the deck, with the copy. Callers
 * pass the slug (`/d/:slug`) or share token (`/s/:token`) as `sourceKey`.
 */
export function publicDeckLocalId(sourceKey: string): string {
  return `public:${sourceKey}`;
}

/** A slot id that is stable for a given deck+position, so playtest snapshots
 *  and React keys survive a re-fetch of the same payload. */
function slotIdFor(zone: string, index: number): string {
  return `pub-${zone}-${index}`;
}

function toDeckCards(slots: ReadonlyArray<{ card: unknown }>, zone: string): DeckCard[] {
  return slots.map((slot, i) => ({
    slotId: slotIdFor(zone, i),
    card: slot.card as ScryfallCard,
    // A visitor owns none of these copies — allocation is an owner-side
    // concept, and leaving it null is what makes DeckDisplay's cross-deck
    // "claimed elsewhere" work short-circuit (see its `crossDeck` memo).
    allocatedCopyId: null,
  }));
}

/** Only a format we actually have a config for; anything else reads as commander. */
function toFormat(format: string): DeckFormat {
  return (
    Object.prototype.hasOwnProperty.call(DECK_FORMAT_CONFIGS, format) ? format : 'commander'
  ) as DeckFormat;
}

export function publicDeckToDeck(data: PublicDeck, sourceKey: string): Deck {
  return {
    id: publicDeckLocalId(sourceKey),
    name: data.name,
    format: toFormat(data.format),
    source: 'manual',
    commander: (data.commander as ScryfallCard | null) ?? null,
    partnerCommander: (data.partnerCommander as ScryfallCard | null) ?? null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: toDeckCards(data.cards, 'main'),
    sideboard: toDeckCards(data.sideboard, 'side'),
    // Considering is a private scratch zone — the projection never ships it,
    // and a visitor has nothing to park there.
    considering: [],
    generationContext: null,
    color: data.color,
    createdAt: data.updatedAt ?? 0,
    updatedAt: data.updatedAt ?? 0,
    primer: data.primer,

    // ── Deck-describing analysis (Stats + Power tabs) ──────────────────────
    bracketEstimation: data.bracketEstimation as BracketEstimation | undefined,
    bracketOverride: data.bracketOverride,
    deckGrade: data.deckGrade,
    planScore: data.planScore as PlanScore | undefined,
    synergyAnalysis: data.synergyAnalysis as SynergyAnalysis | undefined,
    winConditions: data.winConditions as WinConditionAnalysis | undefined,
    winConTags: data.winConTags,
    roleCounts: data.roleCounts,
    roleTargets: data.roleTargets,
    rampSubtypeCounts: data.rampSubtypeCounts,
    removalSubtypeCounts: data.removalSubtypeCounts,
    boardwipeSubtypeCounts: data.boardwipeSubtypeCounts,
    cardDrawSubtypeCounts: data.cardDrawSubtypeCounts,
    cardInclusionMap: data.cardInclusionMap,
    edhrecNumDecks: data.edhrecNumDecks,
    archetypeOverride: (data.archetypeOverride as Archetype | null | undefined) ?? null,
    buildReport: data.buildReport as BuildReport | undefined,
    categoryTargets: data.categoryTargets as Partial<Record<DeckCategory, number>> | undefined,
    averageSalt: data.averageSalt,
    saltiestCards: data.saltiestCards,
    sourceProduct: data.sourceProduct,
  };
}

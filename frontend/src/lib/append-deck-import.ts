import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  commanderCandidatesFor,
  partnerCandidatesFor,
} from '../components/deck/import-deck-shared';
import {
  buildAllocationMap,
  allocateCardsForImport,
  pickCollectionCopy,
  type AllocationInfo,
} from './allocations';
import { getMaxCopies } from './deck-validation';
import type { Deck, DeckCard } from '../store/decks';
import type { DeckImportResponse, EnrichedCard } from '../types';

/**
 * Commander-zone decision for pasting into a deck that already exists —
 * unlike whole-deck import (create flow), an append must never silently
 * change a deck's commander. Four branches:
 *
 *  - `no-commander-in-paste` — the format has no commander slot, or the
 *     paste didn't specify one (no `Commander` section header, and no single
 *     unambiguous commander-eligible card among the pasted cards when the
 *     deck has none yet either). Nothing about the commander changes.
 *  - `matches-existing` — the paste's `Commander` line names the SAME card
 *     the deck already has. Treated as a duplicate: deduped out of the main
 *     list, existing commander/allocation left untouched.
 *  - `conflicts-with-existing` — the paste's `Commander` line names a
 *     DIFFERENT card than the deck's current commander. Never auto-replaces
 *     — the pasted card is added as a normal card instead (subject to the
 *     usual copy-limit/color-identity checks), and the review step surfaces
 *     the conflict explicitly.
 *  - `deck-has-none` — the deck has no commander yet (a freshly created deck,
 *     or one whose commander was removed). `candidates` lists what the paste
 *     offers — the explicit `Commander` line if present, else every
 *     commander-eligible card found among the pasted cards (deduped). Always
 *     requires an explicit user pick in the review step; never auto-applied,
 *     even when there's exactly one candidate.
 */
export type AppendCommanderDecision =
  | { kind: 'no-commander-in-paste' }
  | { kind: 'matches-existing'; commander: ScryfallCard }
  | { kind: 'conflicts-with-existing'; existing: ScryfallCard; pasted: ScryfallCard }
  | { kind: 'deck-has-none'; candidates: ScryfallCard[] };

export function resolveAppendCommanderDecision(
  format: DeckFormat,
  existingCommander: ScryfallCard | null,
  result: DeckImportResponse
): AppendCommanderDecision {
  const config = DECK_FORMAT_CONFIGS[format];
  if (!config.hasCommander) return { kind: 'no-commander-in-paste' };

  if (existingCommander) {
    if (!result.commander) return { kind: 'no-commander-in-paste' };
    if (result.commander.name === existingCommander.name) {
      return { kind: 'matches-existing', commander: existingCommander };
    }
    return {
      kind: 'conflicts-with-existing',
      existing: existingCommander,
      pasted: result.commander,
    };
  }

  const candidates = result.commander
    ? [result.commander]
    : commanderCandidatesFor(result.cards, format);
  return { kind: 'deck-has-none', candidates };
}

/** Legal partners offered alongside a `deck-has-none` commander pick — empty for every other branch. */
export function appendPartnerCandidatesFor(
  result: DeckImportResponse,
  chosenCommander: ScryfallCard | null
): ScryfallCard[] {
  return partnerCandidatesFor(result.cards, chosenCommander);
}

/** One pasted card name that hit its format copy limit and was left out of the append. */
export interface SkippedDuplicate {
  name: string;
  /** How many pasted copies were dropped (already-owned count + limit, not the raw paste count). */
  count: number;
}

/** The complete post-paste deck shape — committed with exactly ONE store write (see AppendDeckDialog). */
export interface AppendPlan {
  cards: DeckCard[];
  sideboard: DeckCard[];
  considering: DeckCard[];
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: string | null;
  /** Just the newly appended slots (subset of `cards`/`sideboard`/`considering`
   *  above) — lets the review step scope a post-paste legality check to only
   *  what THIS paste added, instead of re-surfacing issues the deck already had. */
  addedCards: DeckCard[];
  addedSideboard: DeckCard[];
  addedConsidering: DeckCard[];
  /** Total slots actually appended across cards/sideboard/considering — 0 disables Confirm. */
  addedCount: number;
  skippedDuplicates: SkippedDuplicate[];
  commanderDecision: AppendCommanderDecision;
}

/**
 * Pure core: builds the full `{cards, sideboard, considering, commander?}`
 * shape for appending a resolved paste onto an EXISTING deck, claiming owned
 * physical copies as it goes. Never mutates `deck` — the caller commits the
 * result with a single `replaceDeck` call wrapped in one `recordEdit`, so a
 * 60-card paste is one store write (and one sync push), not one per card.
 *
 * `chosenCommander`/`chosenPartner` are the user's explicit review-step picks
 * for the `deck-has-none` branch — ignored for every other branch (a deck
 * that already has a commander never takes one from here).
 */
export function buildAppendPlan(
  deck: Deck,
  result: DeckImportResponse,
  chosenCommander: ScryfallCard | null,
  chosenPartner: ScryfallCard | null,
  ctx: { decks: Deck[]; collectionCards: EnrichedCard[] }
): AppendPlan {
  const config = DECK_FORMAT_CONFIGS[deck.format];
  const decision = resolveAppendCommanderDecision(deck.format, deck.commander, result);

  // Existing per-name counts across commander/cards/sideboard — the zones the
  // format copy limit actually governs (mirrors deck-validation.ts's own
  // "counted across main + side combined"). `considering` is deliberately
  // excluded, same as every other legality check in the codebase (see the
  // Deck.considering doc comment) — it's a non-committal maybe-pile, not part
  // of the deck the singleton rule applies to, so re-pasting a card already
  // parked there is never treated as a duplicate.
  const existingCounts = new Map<string, number>();
  const bump = (name: string) => existingCounts.set(name, (existingCounts.get(name) ?? 0) + 1);
  if (deck.commander) bump(deck.commander.name);
  if (deck.partnerCommander) bump(deck.partnerCommander.name);
  for (const c of deck.cards) bump(c.card.name);
  for (const c of deck.sideboard ?? []) bump(c.card.name);

  const skipped = new Map<string, number>();
  const filterForCopyLimit = (list: ScryfallCard[]): ScryfallCard[] => {
    const kept: ScryfallCard[] = [];
    for (const card of list) {
      const max = getMaxCopies(card, config.isSingleton);
      const have = existingCounts.get(card.name) ?? 0;
      if (have >= max) {
        skipped.set(card.name, (skipped.get(card.name) ?? 0) + 1);
        continue;
      }
      existingCounts.set(card.name, have + 1);
      kept.push(card);
    }
    return kept;
  };

  let commander = deck.commander;
  let partnerCommander = deck.partnerCommander;
  let mainCandidates = result.cards;

  if (decision.kind === 'matches-existing') {
    // Same card the deck already has as commander — drop it from the main
    // list rather than double-counting it against the copy limit.
    mainCandidates = mainCandidates.filter((c) => c.name !== decision.commander.name);
  } else if (decision.kind === 'deck-has-none' && chosenCommander) {
    commander = chosenCommander;
    partnerCommander = chosenPartner;
    mainCandidates = mainCandidates.filter(
      (c) => c.name !== chosenCommander.name && (!chosenPartner || c.name !== chosenPartner.name)
    );
    bump(chosenCommander.name);
    if (chosenPartner) bump(chosenPartner.name);
  }
  // 'conflicts-with-existing' and 'no-commander-in-paste' (and 'deck-has-none'
  // with no chosenCommander yet): mainCandidates is untouched — a conflicting
  // or not-yet-chosen commander candidate is just a normal card, subject to
  // the same copy-limit filter as everything else.

  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(ctx.decks));
  const newMain = allocateCardsForImport(
    filterForCopyLimit(mainCandidates),
    ctx.collectionCards,
    claimed
  );
  const newSide = allocateCardsForImport(
    filterForCopyLimit(result.sideboard ?? []),
    ctx.collectionCards,
    claimed
  );
  // No copy-limit filter here — considering is exempt (see the comment above).
  const newConsider = allocateCardsForImport(
    result.considering ?? [],
    ctx.collectionCards,
    claimed
  );

  let commanderAllocatedCopyId = deck.commanderAllocatedCopyId;
  let partnerCommanderAllocatedCopyId = deck.partnerCommanderAllocatedCopyId;
  if (decision.kind === 'deck-has-none' && chosenCommander) {
    const pick = pickCollectionCopy(
      chosenCommander.name,
      ctx.collectionCards,
      claimed,
      chosenCommander.id
    );
    commanderAllocatedCopyId = pick?.copyId ?? null;
    if (chosenPartner) {
      const partnerPick = pickCollectionCopy(
        chosenPartner.name,
        ctx.collectionCards,
        claimed,
        chosenPartner.id
      );
      partnerCommanderAllocatedCopyId = partnerPick?.copyId ?? null;
    } else {
      partnerCommanderAllocatedCopyId = null;
    }
  }

  return {
    cards: [...deck.cards, ...newMain],
    sideboard: [...(deck.sideboard ?? []), ...newSide],
    considering: [...(deck.considering ?? []), ...newConsider],
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    addedCards: newMain,
    addedSideboard: newSide,
    addedConsidering: newConsider,
    addedCount: newMain.length + newSide.length + newConsider.length,
    skippedDuplicates: [...skipped.entries()].map(([name, count]) => ({ name, count })),
    commanderDecision: decision,
  };
}

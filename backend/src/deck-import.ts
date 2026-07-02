import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';
import type { ScryfallCache } from './cache';
import { resolveCards } from './scryfall';
import { expandByQuantity, MAX_QTY_PER_ROW } from './import-limits';

export interface DeckSections {
  commander: ScryfallCard | null;
  companion: ScryfallCard | null;
  cards: ScryfallCard[];
  unresolvedNames: string[];
}

/**
 * Resolves a deck's already-sectioned rows (commander / companion / deck) into
 * the {@link DeckSections} response shape. Shared by the text `/api/import-deck`
 * endpoint and the MTGJSON product path, which both build the same section row
 * arrays and need identical resolution semantics.
 *
 * Two-pass resolution: first try with each row's full info (scryfallId, or
 * name+set+collector). For any row that didn't resolve AND originally had a
 * collectorNumber, retry without it — some exports use collector numbers
 * Scryfall doesn't recognize for the exact printing, so falling back to
 * name+set still produces a card.
 */
export async function resolveDeckRows(
  commanderRows: ImportRow[],
  companionRows: ImportRow[],
  deckRows: ImportRow[],
  cache: ScryfallCache
): Promise<DeckSections> {
  const allRows = [...commanderRows, ...companionRows, ...deckRows];
  const expanded = expandByQuantity(allRows);
  const firstPass = await resolveCards(expanded, cache);
  const resolved = firstPass.resolved;

  const retryIdxs: number[] = [];
  resolved.forEach((card, i) => {
    if (!card && expanded[i].collectorNumber) retryIdxs.push(i);
  });
  if (retryIdxs.length > 0) {
    const retryRows = retryIdxs.map((i) => ({ ...expanded[i], collectorNumber: undefined }));
    const retry = await resolveCards(retryRows, cache);
    retryIdxs.forEach((origIdx, j) => {
      if (retry.resolved[j]) resolved[origIdx] = retry.resolved[j];
    });
  }

  return sliceResolvedDeckImport(commanderRows, companionRows, deckRows, resolved);
}

// MUST mirror expandByQuantity's clamp: the slice boundaries below are derived
// from these counts and would mis-align (throwing a generic 500) against the
// clamped resolved[] array when a row's quantity exceeds MAX_QTY_PER_ROW.
function rowQty(row: ImportRow): number {
  return Math.min(MAX_QTY_PER_ROW, Math.max(1, row.quantity || 1));
}

function totalQty(rows: ImportRow[]): number {
  let sum = 0;
  for (const r of rows) sum += rowQty(r);
  return sum;
}

/**
 * Splits the per-row resolved-cards array (one entry per physical copy, in
 * commander → companion → deck order) into the response shape the /api/import-deck
 * endpoint returns.
 *
 * Why one entry per copy: the previous implementation collapsed duplicate
 * (name, setCode) rows into a single ScryfallCard, losing printing precision —
 * 5 copies of "Plains FDN #272" and 1 of "Plains FDN #282" both got mapped to
 * the same scryfallId because the dedup key ignored collectorNumber. Iterating
 * the resolved array per-copy preserves whatever printing each row resolved to,
 * so basic lands (and any other same-name multi-printing case) stay distinct
 * in the deck.
 *
 * `resolved` MUST be the output of resolving expandByQuantity(commanderRows ++
 * companionRows ++ deckRows) — the slice boundaries are computed from row
 * quantities and would mis-align if the upstream changed order or expansion.
 */
export function sliceResolvedDeckImport(
  commanderRows: ImportRow[],
  companionRows: ImportRow[],
  deckRows: ImportRow[],
  resolved: Array<ScryfallCard | undefined>
): DeckSections {
  const expectedLength = totalQty(commanderRows) + totalQty(companionRows) + totalQty(deckRows);
  if (resolved.length !== expectedLength) {
    throw new Error(
      `sliceResolvedDeckImport: resolved length ${resolved.length} != expected ${expectedLength}`
    );
  }

  const commanderEnd = totalQty(commanderRows);
  const companionEnd = commanderEnd + totalQty(companionRows);

  const commander = commanderRows.length > 0 ? (resolved[0] ?? null) : null;
  const companion = companionRows.length > 0 ? (resolved[commanderEnd] ?? null) : null;

  const cards: ScryfallCard[] = [];
  for (let i = companionEnd; i < resolved.length; i++) {
    const card = resolved[i];
    if (card) cards.push(card);
  }

  const unresolvedNames: string[] = [];
  // Walk the rows in the same order resolved[] was produced so the names we
  // report match the cards that failed to resolve.
  let cursor = 0;
  const walk = (rows: ImportRow[]) => {
    for (const r of rows) {
      const qty = rowQty(r);
      for (let i = 0; i < qty; i++) {
        if (!resolved[cursor + i] && r.name) unresolvedNames.push(r.name);
      }
      cursor += qty;
    }
  };
  walk(commanderRows);
  walk(companionRows);
  walk(deckRows);

  return { commander, companion, cards, unresolvedNames };
}

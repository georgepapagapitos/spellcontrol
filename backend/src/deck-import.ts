import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';

export interface DeckSections {
  commander: ScryfallCard | null;
  companion: ScryfallCard | null;
  cards: ScryfallCard[];
  unresolvedNames: string[];
}

function rowQty(row: ImportRow): number {
  return Math.max(1, row.quantity || 1);
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

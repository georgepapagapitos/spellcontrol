import type {
  BinderFilter,
  ChipExpression,
  EnrichedCard,
  MaterializedBinder,
  ScryfallQueryRule,
  SortDir,
  SortField,
} from '@/types/index';
import type { SetMap } from '@/lib/api';
import { formatMoney } from '@/lib/collection/format-money';
import { LANGUAGE_OPTIONS } from '@/lib/collection/copy-options';
import { printingKey, sortCards, type SortContext } from '@spellcontrol/binder-routing';
import { releaseDateOf } from '@spellcontrol/binder-routing';
import { isExpressionEmpty } from '@spellcontrol/binder-routing';
import { parseTypeLine, SUPERTYPES, TYPES } from '@spellcontrol/binder-routing';
import { SORT_KEY_TO_FIELD, type Row, type SortKey } from './card-list-table-config';

// The pure derivations CardListTable memoizes over (row building, the
// engine-filter assembly, sorting, the grid caption, filter dropdown options),
// lifted out of the component body (T176). No hooks, no React: each function
// is the body of a `useMemo` (or effect) that used to sit inline.

export interface BinderAssignment {
  id: string;
  name: string;
  color: string;
}

export function buildCardToBinder(binders: MaterializedBinder[]): Map<string, BinderAssignment> {
  // Per-copy assignment — pinned and rule-matched cards are routed by
  // copyId in materializeBinders, so we mirror that here. Falls back to
  // printing+finish for old materialized cards without a copyId.
  const map = new Map<string, BinderAssignment>();
  for (const b of binders) {
    for (const section of b.sections) {
      for (const c of section.cards) {
        const assignment = { id: b.def.id, name: b.def.name, color: b.def.color };
        if (c.copyId && !map.has(c.copyId)) map.set(c.copyId, assignment);
      }
    }
  }
  return map;
}

export function buildRows(
  cardsForMatch: EnrichedCard[],
  cardToBinder: Map<string, BinderAssignment>,
  groupPrintings: boolean
): Row[] {
  if (!groupPrintings) {
    // One row per physical copy.
    return cardsForMatch.map((card) => {
      const assignment = cardToBinder.get(card.copyId) ?? null;
      return {
        // copyId is unique per physical copy — gives every row a
        // stable key even when two share the same printing+foil.
        key: card.copyId,
        card,
        qty: 1,
        binderId: assignment?.id ?? null,
        binderName: assignment?.name ?? null,
        binderColor: assignment?.color ?? null,
        binders: assignment ? [assignment] : [],
      };
    });
  }
  // Default: roll duplicate copies of the same printing into one row.
  // Primary binder fields reflect the first assigned copy seen; the
  // `binders` array aggregates every distinct binder across the stack so
  // the badge can show all of them.
  const grouped = new Map<string, Row & { binderIds: Set<string> }>();
  for (const card of cardsForMatch) {
    const key = `${card.scryfallId}:${card.finish ?? (card.foil ? 'foil' : 'nonfoil')}`;
    const assignment = cardToBinder.get(card.copyId) ?? null;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += 1;
      if (assignment && !existing.binderIds.has(assignment.id)) {
        existing.binderIds.add(assignment.id);
        existing.binders.push(assignment);
        if (!existing.binderId) {
          existing.binderId = assignment.id;
          existing.binderName = assignment.name;
          existing.binderColor = assignment.color;
        }
      }
    } else {
      const binderIds = new Set<string>();
      if (assignment) binderIds.add(assignment.id);
      grouped.set(key, {
        key,
        card,
        qty: 1,
        binderId: assignment?.id ?? null,
        binderName: assignment?.name ?? null,
        binderColor: assignment?.color ?? null,
        binders: assignment ? [assignment] : [],
        binderIds,
      });
    }
  }
  return [...grouped.values()].map(({ binderIds: _ids, ...row }) => row);
}

/** The engine-matchable slice of the filter state (everything that maps onto a
 *  BinderFilter field; binder/condition/language/colour are post-checks). */
export interface MatchFilterState {
  supertypeExpr: ChipExpression;
  typesExpr: ChipExpression;
  subtypeExpr: ChipExpression;
  rarityExpr: ChipExpression;
  oracleExpr: ChipExpression;
  oracleTagExpr: ChipExpression;
  scryfallQuery: ScryfallQueryRule | undefined;
  legalityExpr: ChipExpression;
  layoutExpr: ChipExpression;
  treatmentExpr: ChipExpression;
  borderExpr: ChipExpression;
  finishExpr: ChipExpression;
  setFilter: Set<string>;
  priceMin: number | undefined;
  priceMax: number | undefined;
  cmcMin: number | undefined;
  cmcMax: number | undefined;
  debouncedSearch: string;
}

/** Build a BinderFilter from all the non-collection-specific filter state and
 *  let the engine handle matching. */
export function buildMatchFilter(s: MatchFilterState): BinderFilter {
  const f: BinderFilter = {};
  if (!isExpressionEmpty(s.supertypeExpr)) f.supertypeChips = s.supertypeExpr;
  if (!isExpressionEmpty(s.typesExpr)) f.typeTokenChips = s.typesExpr;
  if (!isExpressionEmpty(s.subtypeExpr)) f.subtypeChips = s.subtypeExpr;
  if (!isExpressionEmpty(s.rarityExpr)) f.rarities = s.rarityExpr;
  if (!isExpressionEmpty(s.oracleExpr)) f.oracleChips = s.oracleExpr;
  if (!isExpressionEmpty(s.oracleTagExpr)) f.oracleTagChips = s.oracleTagExpr;
  if (s.scryfallQuery) f.scryfallQuery = s.scryfallQuery;
  if (!isExpressionEmpty(s.legalityExpr)) f.legalities = s.legalityExpr;
  if (!isExpressionEmpty(s.layoutExpr)) f.layouts = s.layoutExpr;
  if (!isExpressionEmpty(s.treatmentExpr)) f.treatments = s.treatmentExpr;
  if (!isExpressionEmpty(s.borderExpr)) f.borderColors = s.borderExpr;
  if (!isExpressionEmpty(s.finishExpr)) f.finishes = s.finishExpr;
  if (s.setFilter.size > 0) f.setCodes = [...s.setFilter].map((c) => c.toUpperCase());
  if (s.priceMin !== undefined) f.priceMin = s.priceMin;
  if (s.priceMax !== undefined) f.priceMax = s.priceMax;
  if (s.cmcMin !== undefined) f.cmcMin = s.cmcMin;
  if (s.cmcMax !== undefined) f.cmcMax = s.cmcMax;
  const trimmed = s.debouncedSearch.trim();
  if (trimmed) f.nameContains = trimmed;
  return f;
}

export function sortRows(
  filtered: Row[],
  sortKey: SortKey,
  sortDir: 'asc' | 'desc',
  setMap: SetMap | undefined,
  addedAtByImportId: Map<string, number>
): Row[] {
  const field: SortField = SORT_KEY_TO_FIELD[sortKey];
  const dir: SortDir = sortDir;
  // Map row.qty into a printing-keyed table so the shared comparator's
  // "quantity" sort uses the displayed (rolled-up or per-copy) qty.
  const qtyByPrintingKey = new Map<string, number>();
  for (const r of filtered) qtyByPrintingKey.set(printingKey(r.card), r.qty);
  const ctx: SortContext = { setMap, qtyByPrintingKey, addedAtByImportId };
  const sortedCards = sortCards(
    filtered.map((r) => r.card),
    [{ field, dir }],
    ctx
  );
  const byCopyId = new Map(filtered.map((r) => [r.card.copyId, r]));
  return sortedCards.map((c) => byCopyId.get(c.copyId)!).filter(Boolean) as Row[];
}

const captionDate = (t: number | undefined): string =>
  t
    ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

/** Grid caption text — echoes the active sort key's value so any ordering is
 *  legible in grid view: dates for the date sorts, rank for the EDHREC sort,
 *  otherwise the card's price (the one collector datum the art can't show).
 *  Price is unit + pinned USD, matching the sort key and the list rows
 *  (purchasePrice is USD-sourced; see CardRow). */
export function gridCaptionFor(
  r: Row,
  sortKey: SortKey,
  addedAtByImportId: Map<string, number>,
  setMap: SetMap | undefined
): string {
  switch (sortKey) {
    case 'added':
      return captionDate(addedAtByImportId.get(r.card.importId ?? ''));
    case 'edited':
      return captionDate(r.card.updatedAt ?? addedAtByImportId.get(r.card.importId ?? ''));
    case 'release': {
      // The date the sort used, the printing's own, not its set's (every
      // Secret Lair would otherwise read Dec 2, 2019).
      const released = releaseDateOf(r.card, setMap);
      // Parse as local midnight — a bare YYYY-MM-DD parses as UTC and can
      // render a day early in negative-offset timezones.
      return released ? captionDate(new Date(`${released}T00:00:00`).getTime()) : '—';
    }
    case 'edhrec':
      return r.card.edhrecRank != null ? `#${r.card.edhrecRank.toLocaleString('en-US')}` : '—';
    default:
      return formatMoney(r.card.purchasePrice, { currency: 'USD', zeroAsDash: true });
  }
}

/** Language filter options — derived from what's actually in the user's
 *  collection, not a fixed enum (LANGUAGE_OPTIONS is the full add-card
 *  vocabulary, most of which a given collection never uses). Absent
 *  language means English, mirroring CardRow's display-chip convention. */
export function buildLanguageOptions(cards: EnrichedCard[]) {
  const codes = new Set<string>();
  for (const c of cards) codes.add((c.language || 'en').toLowerCase());
  return [...codes].sort().map((code) => ({
    value: code,
    label: String(LANGUAGE_OPTIONS.find((o) => o.value === code)?.label ?? code.toUpperCase()),
  }));
}

/** Subtype tokens actually present in the collection, so unusual entries
 *  (custom or fan sets) still surface in the subtype autocomplete. */
export function collectSubtypeTokens(cards: EnrichedCard[]): Set<string> {
  const tokens = new Set<string>();
  for (const c of cards) {
    const { subtypes } = parseTypeLine(c.typeLine);
    for (const s of subtypes) tokens.add(s);
  }
  return tokens;
}

/** Merge the Scryfall type catalog with the collection's own subtype tokens.
 *  Supertypes and primary Types are closed enums (rendered as dropdowns), so
 *  they are stripped; only the subtype row needs suggestions. */
export function mergeSubtypeSuggestions(
  catalog: string[],
  collectionSubtypeTokens: Set<string>
): string[] {
  const supertypeSet = new Set<string>(SUPERTYPES);
  const typeSet = new Set<string>(TYPES);
  // Dedupe by lowercase key but prefer the version that has any
  // capitals — the Scryfall catalog supplies canonical casing
  // ("Angel") while parseTypeLine lowercases collection tokens
  // ("angel"). Without this the autocomplete shows both spellings.
  const byLower = new Map<string, string>();
  for (const t of [...catalog, ...collectionSubtypeTokens]) {
    const key = t.toLowerCase();
    if (supertypeSet.has(key) || typeSet.has(key)) continue;
    const existing = byLower.get(key);
    if (!existing || (existing === key && t !== key)) {
      byLower.set(key, t);
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

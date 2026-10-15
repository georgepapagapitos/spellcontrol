import type { BinderFilter, ChipExpression, ScryfallQueryRule } from '@/types/index';
import {
  compileExpression,
  compileFilter,
  isExpressionEmpty,
  type ColorMatchMode,
} from '@spellcontrol/binder-routing';
import { countMatchingRows, type FilterableRow } from '@/lib/search/collection-filter';
import type { FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
import { buildActiveFilterChips } from '@/components/collection/card-list-filter-chips';
import { buildMatchFilter } from '@/components/collection/card-list-table-derive';

/**
 * The Filters dialog's draft: every field the dialog edits, in one object so a
 * chip's "clear" and the zero-match "which field is it" probe can run over a
 * scratch copy of it. Seeded from the committed props on open; committed only
 * by Show N.
 */
export interface FilterDraft {
  supertype: ChipExpression;
  types: ChipExpression;
  subtype: ChipExpression;
  color: Set<string>;
  colorMode: ColorMatchMode;
  rarity: ChipExpression;
  oracle: ChipExpression;
  oracleTag: ChipExpression;
  scryfallQuery: ScryfallQueryRule | undefined;
  legality: ChipExpression;
  layout: ChipExpression;
  treatment: ChipExpression;
  border: ChipExpression;
  finish: ChipExpression;
  condition: ChipExpression;
  language: ChipExpression;
  binder: ChipExpression;
  setFilter: Set<string>;
  priceMin: number | undefined;
  priceMax: number | undefined;
  cmcMin: number | undefined;
  cmcMax: number | undefined;
  manaValues: BinderFilter['manaValues'];
  manaSymbols: BinderFilter['manaSymbols'];
  surplusOnly: boolean;
  proxyOnly: boolean;
}

export const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

/** A draft with nothing set. */
export function emptyDraft(): FilterDraft {
  return {
    supertype: EMPTY_EXPR,
    types: EMPTY_EXPR,
    subtype: EMPTY_EXPR,
    color: new Set(),
    colorMode: 'any',
    rarity: EMPTY_EXPR,
    oracle: EMPTY_EXPR,
    oracleTag: EMPTY_EXPR,
    scryfallQuery: undefined,
    legality: EMPTY_EXPR,
    layout: EMPTY_EXPR,
    treatment: EMPTY_EXPR,
    border: EMPTY_EXPR,
    finish: EMPTY_EXPR,
    condition: EMPTY_EXPR,
    language: EMPTY_EXPR,
    binder: EMPTY_EXPR,
    setFilter: new Set(),
    priceMin: undefined,
    priceMax: undefined,
    cmcMin: undefined,
    cmcMax: undefined,
    manaValues: undefined,
    manaSymbols: undefined,
    surplusOnly: false,
    proxyOnly: false,
  };
}

/** The chips the active-filter strip shows for a draft; each one's clear writes through `apply`. */
export function draftChips(
  d: FilterDraft,
  apply: (patch: Partial<FilterDraft>) => void
): FilterChipDescriptor[] {
  return buildActiveFilterChips({
    search: '',
    colorFilter: d.color,
    colorMode: d.colorMode,
    rarityExpr: d.rarity,
    supertypeExpr: d.supertype,
    typesExpr: d.types,
    subtypeExpr: d.subtype,
    oracleExpr: d.oracle,
    oracleTagExpr: d.oracleTag,
    scryfallQuery: d.scryfallQuery,
    legalityExpr: d.legality,
    layoutExpr: d.layout,
    treatmentExpr: d.treatment,
    borderExpr: d.border,
    finishExpr: d.finish,
    conditionExpr: d.condition,
    languageExpr: d.language,
    binderExpr: d.binder,
    setFilter: d.setFilter,
    priceMin: d.priceMin,
    priceMax: d.priceMax,
    cmcMin: d.cmcMin,
    cmcMax: d.cmcMax,
    manaValues: d.manaValues,
    manaSymbols: d.manaSymbols,
    surplusOnly: d.surplusOnly,
    proxyOnly: d.proxyOnly,
    EMPTY_EXPR,
    setSearch: () => {},
    setColorFilter: (color) => apply({ color }),
    setRarityExpr: (rarity) => apply({ rarity }),
    setSupertypeExpr: (supertype) => apply({ supertype }),
    setTypesExpr: (types) => apply({ types }),
    setSubtypeExpr: (subtype) => apply({ subtype }),
    setOracleExpr: (oracle) => apply({ oracle }),
    setOracleTagExpr: (oracleTag) => apply({ oracleTag }),
    setScryfallQuery: (scryfallQuery) => apply({ scryfallQuery }),
    setLegalityExpr: (legality) => apply({ legality }),
    setLayoutExpr: (layout) => apply({ layout }),
    setTreatmentExpr: (treatment) => apply({ treatment }),
    setBorderExpr: (border) => apply({ border }),
    setFinishExpr: (finish) => apply({ finish }),
    setConditionExpr: (condition) => apply({ condition }),
    setLanguageExpr: (language) => apply({ language }),
    setBinderExpr: (binder) => apply({ binder }),
    setSetFilter: (setFilter) => apply({ setFilter }),
    setPriceMin: (priceMin) => apply({ priceMin }),
    setPriceMax: (priceMax) => apply({ priceMax }),
    setCmcMin: (cmcMin) => apply({ cmcMin }),
    setCmcMax: (cmcMax) => apply({ cmcMax }),
    setManaValues: (manaValues) => apply({ manaValues }),
    setManaSymbols: (manaSymbols) => apply({ manaSymbols }),
    setSurplusOnly: (surplusOnly) => apply({ surplusOnly }),
    setProxyOnly: (proxyOnly) => apply({ proxyOnly }),
  });
}

export interface DraftCountContext {
  rows: readonly FilterableRow[];
  surplusByName?: ReadonlySet<string> | Map<string, unknown>;
  /** The page's search box: outside the dialog, but it narrows the same list. */
  searchTerm?: string;
}

/** How many rows the draft matches, by the predicate the page itself runs. */
export function countDraft(d: FilterDraft, ctx: DraftCountContext): number {
  return countMatchingRows(ctx.rows, {
    matchFilter: compileFilter(
      buildMatchFilter({
        supertypeExpr: d.supertype,
        typesExpr: d.types,
        subtypeExpr: d.subtype,
        rarityExpr: d.rarity,
        oracleExpr: d.oracle,
        oracleTagExpr: d.oracleTag,
        scryfallQuery: d.scryfallQuery,
        legalityExpr: d.legality,
        layoutExpr: d.layout,
        treatmentExpr: d.treatment,
        borderExpr: d.border,
        finishExpr: d.finish,
        setFilter: d.setFilter,
        priceMin: d.priceMin,
        priceMax: d.priceMax,
        cmcMin: d.cmcMin,
        cmcMax: d.cmcMax,
        manaValues: d.manaValues,
        manaSymbols: d.manaSymbols,
        debouncedSearch: ctx.searchTerm ?? '',
      })
    ),
    binder: isExpressionEmpty(d.binder) ? null : compileExpression(d.binder),
    colors: d.color,
    colorMode: d.colorMode,
    condition: isExpressionEmpty(d.condition) ? null : compileExpression(d.condition),
    language: isExpressionEmpty(d.language) ? null : compileExpression(d.language),
    surplusOnly: d.surplusOnly,
    surplusByName: ctx.surplusByName,
    proxyOnly: d.proxyOnly,
  });
}

/**
 * At zero matches: the one filter whose removal brings cards back, when exactly
 * one does. Each active chip is cleared on a scratch copy of the draft (its own
 * clear logic, so the chip and the probe cannot drift) and the copy recounted.
 * Null when none, or more than one, would help: naming one of several would
 * mislead. Runs only at zero, so the extra counts are not paid on every tap.
 */
export function singleBlockingFilter(d: FilterDraft, ctx: DraftCountContext): string | null {
  const chips = draftChips(d, () => {});
  if (chips.length < 2) return null;
  const rescuers: string[] = [];
  for (const chip of chips) {
    const scratch: FilterDraft = { ...d };
    draftChips(d, (patch) => Object.assign(scratch, patch))
      .find((c) => c.id === chip.id)
      ?.onClear();
    if (countDraft(scratch, ctx) > 0) rescuers.push(chip.label);
  }
  return rescuers.length === 1 ? rescuers[0] : null;
}

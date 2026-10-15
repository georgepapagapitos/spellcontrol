import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BinderFilter, ChipExpression, ScryfallQueryRule } from '@/types/index';
import { compileExpression, compileFilter, isExpressionEmpty } from '@spellcontrol/binder-routing';
import {
  manaSymbolQueryIsActive,
  normalizeManaValues,
  type ColorMatchMode,
} from '@spellcontrol/binder-routing';
import { rowMatchesCollectionFilter } from '@/lib/search/collection-filter';
import {
  collectionFiltersToFilterGroup,
  deriveBinderName,
  hasStructuredFilter,
} from '@/lib/search/collection-filters-to-binder';
import type { CollectionFilterJump } from '@/lib/collection/collection-insights';
import { useCollectionStore } from '@/store/collection';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import type { FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
import { buildActiveFilterChips } from './card-list-filter-chips';
import { buildMatchFilter } from './card-list-table-derive';
import type { Row } from './card-list-table-config';

// The collection table's filter state, lifted out of CardListTable (E549): the
// search term, every filter dialog field, the "clear all" and external-jump
// paths, the active-filter chips and the Save-as-binder hand-off. `fields`
// holds each value beside its setter under the names CollectionFiltersDialog
// takes, so the table spreads it straight into the dialog.

export function useCollectionFilters(
  filterJump: CollectionFilterJump | null | undefined,
  onFilterJumpApplied: (() => void) | undefined
) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  // Deep-link: /collection?binder=<name> seeds the binder filter at mount.
  // `__uncategorized` is the value the filter dialog itself uses for the
  // fallthrough pile, so the post-import "matched no binder" row (E296) can
  // hand the user straight to the cards that escaped every rule. Captured in
  // the lazy initializer (like CollectionPage's `?add=`) so it survives the
  // param being stripped from the URL on the next line.
  const [searchParams, setSearchParams] = useSearchParams();
  const [binderExpr, setBinderExpr] = useState<ChipExpression>(() => {
    const seed = searchParams.get('binder');
    return seed
      ? { chips: [{ value: seed, negate: false }], joiners: [] }
      : { chips: [], joiners: [] };
  });
  useEffect(() => {
    if (searchParams.get('binder') === null) return;
    // Strip without a history entry so a refresh doesn't silently re-apply a
    // filter the user has since cleared.
    const next = new URLSearchParams(searchParams);
    next.delete('binder');
    setSearchParams(next, { replace: true });
    // Mount only — the value is already captured in state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Default ON: a collection reads as "what printings do I own and how
  // many?" — the rolled-up qty pill matches that mental model. Power
  // users who want to see every physical copy individually can toggle.
  const [groupPrintings, setGroupPrintings] = useState(true);
  // Tradeable-surplus filter: rows whose card name has ≥1 unallocated copy
  // beyond the keep floor (see computeSurplusByName). Independent of
  // groupPrintings — works whether rows are per-printing or per-copy.
  const [surplusOnly, setSurplusOnly] = useState(false);
  const [proxyOnly, setProxyOnly] = useState(false);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMatchMode>('any');
  const [supertypeExpr, setSupertypeExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [typesExpr, setTypesExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [subtypeExpr, setSubtypeExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>({
    chips: [],
    joiners: [],
  });
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [oracleTagExpr, setOracleTagExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [scryfallQuery, setScryfallQuery] = useState<ScryfallQueryRule | undefined>(undefined);
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [borderExpr, setBorderExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [finishExpr, setFinishExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [conditionExpr, setConditionExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [languageExpr, setLanguageExpr] = useState<ChipExpression>({ chips: [], joiners: [] });
  const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
  const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
  const [cmcMin, setCmcMin] = useState<number | undefined>(undefined);
  const [cmcMax, setCmcMax] = useState<number | undefined>(undefined);
  const [manaValues, setManaValues] = useState<BinderFilter['manaValues']>(undefined);
  const [manaSymbols, setManaSymbols] = useState<BinderFilter['manaSymbols']>(undefined);

  // Empty chip expression reused for clearing chip-based filters.
  // Stable reference (same shape every time) — memoized so the
  // chips useMemo dependency doesn't trigger on every render.
  const EMPTY_EXPR = useMemo<ChipExpression>(() => ({ chips: [], joiners: [] }), []);

  // Clear all active filters and the search term at once.
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setColorFilter(new Set());
    setColorMode('any');
    setSupertypeExpr(EMPTY_EXPR);
    setTypesExpr(EMPTY_EXPR);
    setSubtypeExpr(EMPTY_EXPR);
    setRarityExpr(EMPTY_EXPR);
    setOracleExpr(EMPTY_EXPR);
    setOracleTagExpr(EMPTY_EXPR);
    setScryfallQuery(undefined);
    setLegalityExpr(EMPTY_EXPR);
    setLayoutExpr(EMPTY_EXPR);
    setTreatmentExpr(EMPTY_EXPR);
    setBorderExpr(EMPTY_EXPR);
    setFinishExpr(EMPTY_EXPR);
    setConditionExpr(EMPTY_EXPR);
    setLanguageExpr(EMPTY_EXPR);
    setBinderExpr(EMPTY_EXPR);
    setSetFilter(new Set());
    setGroupPrintings(true);
    setSurplusOnly(false);
    setProxyOnly(false);
    setPriceMin(undefined);
    setPriceMax(undefined);
    setCmcMin(undefined);
    setCmcMax(undefined);
    setManaValues(undefined);
    setManaSymbols(undefined);
  }, [EMPTY_EXPR]);

  // A jump from an external surface (currently the Breakdown drawer — see
  // `filterJump`'s doc on Props) clears every other active filter first, then
  // sets only the matching one — otherwise a search term or another chip
  // still in effect would narrow the result below the count the row itself
  // showed ("Blue · 854" landing on fewer than 854 cards). Declared after
  // `clearAllFilters` so it can call it directly with no use-before-define
  // hazard. Unlike the `?binder=` deep link above (which only ever reads at
  // mount), this runs on every change: the drawer and this table are mounted
  // siblings for the whole page's lifetime, not separate navigations.
  useEffect(() => {
    if (!filterJump) return;
    // One-shot request from a sibling surface: applying it IS the sync, and the
    // callback below hands the request back to its owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearAllFilters();
    switch (filterJump.kind) {
      case 'binder':
        setBinderExpr({ chips: [{ value: filterJump.name, negate: false }], joiners: [] });
        break;
      case 'color':
        // 'all' (exact match) mirrors the breakdown bucket's semantics — see
        // lib/collection/collection-insights.ts's colorFilterJump doc.
        setColorFilter(new Set([filterJump.key]));
        setColorMode('all');
        break;
      case 'rarity':
        setRarityExpr({ chips: [{ value: filterJump.key, negate: false }], joiners: [] });
        break;
      case 'type':
        setTypesExpr({ chips: [{ value: filterJump.key, negate: false }], joiners: [] });
        break;
      case 'set':
        setSetFilter(new Set([filterJump.code]));
        break;
      case 'surplus':
        setSurplusOnly(true);
        break;
    }
    onFilterJumpApplied?.();
    // Only the jump's identity should retrigger this — clearAllFilters and
    // the setters are stable-enough (clearAllFilters is itself a useCallback
    // keyed on the stable EMPTY_EXPR constant); onFilterJumpApplied is the
    // caller's inline prop and must stay out or a parent re-render would
    // re-fire this and re-clear filters the user has since changed by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterJump, clearAllFilters]);

  // Count active filter *groups*, not individual chips — five colors
  // selected is still one filter group, so the badge stays glanceable.
  const activeFilterCount =
    (!isExpressionEmpty(supertypeExpr) ? 1 : 0) +
    (!isExpressionEmpty(typesExpr) ? 1 : 0) +
    (!isExpressionEmpty(subtypeExpr) ? 1 : 0) +
    (colorFilter.size > 0 ? 1 : 0) +
    (!isExpressionEmpty(rarityExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleExpr) ? 1 : 0) +
    (!isExpressionEmpty(oracleTagExpr) ? 1 : 0) +
    (scryfallQuery ? 1 : 0) +
    (!isExpressionEmpty(legalityExpr) ? 1 : 0) +
    (!isExpressionEmpty(layoutExpr) ? 1 : 0) +
    (!isExpressionEmpty(treatmentExpr) ? 1 : 0) +
    (!isExpressionEmpty(borderExpr) ? 1 : 0) +
    (!isExpressionEmpty(finishExpr) ? 1 : 0) +
    (!isExpressionEmpty(conditionExpr) ? 1 : 0) +
    (!isExpressionEmpty(languageExpr) ? 1 : 0) +
    (!isExpressionEmpty(binderExpr) ? 1 : 0) +
    (setFilter.size > 0 ? 1 : 0) +
    (priceMin !== undefined || priceMax !== undefined ? 1 : 0) +
    (cmcMin !== undefined || cmcMax !== undefined ? 1 : 0) +
    (normalizeManaValues(manaValues) ? 1 : 0) +
    (manaSymbolQueryIsActive(manaSymbols) ? 1 : 0) +
    (groupPrintings ? 0 : 1) +
    (surplusOnly ? 1 : 0) +
    (proxyOnly ? 1 : 0);

  // Whether at least one STRUCTURED filter (not just a search term) is active.
  // Used to gate the "Save as binder" button.
  // Note: condition, language, and binder filters are deliberately excluded from
  // hasStructuredFilter because they can't be mapped to a binder rule — so those
  // filters alone won't enable the button.
  const structuredFilterActive = hasStructuredFilter({
    colorFilter,
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    scryfallQuery,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    conditionExpr,
    languageExpr,
    binderExpr,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    manaValues,
    manaSymbols,
    search,
  });

  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const handleSaveAsBinderClick = useCallback(() => {
    const filterInput = {
      colorFilter,
      colorMode,
      proxyOnly,
      surplusOnly,
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      rarityExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      conditionExpr,
      languageExpr,
      binderExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      manaValues,
      manaSymbols,
      search,
    };
    const { group, flagged } = collectionFiltersToFilterGroup(filterInput);
    const name = deriveBinderName(filterInput);
    setEditingBinder('new', { name, groups: [group], flagged });
  }, [
    colorFilter,
    colorMode,
    proxyOnly,
    surplusOnly,
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    scryfallQuery,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    conditionExpr,
    languageExpr,
    binderExpr,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    manaValues,
    manaSymbols,
    search,
    setEditingBinder,
  ]);

  // Build the active-filter chip descriptors — one per non-empty filter group.
  // Each chip knows how to clear its own slice so × on a chip is surgical.
  // The chips are derived state; the single place that maps filter state →
  // human labels avoids scattering label strings across the JSX.
  const activeFilterChips = useMemo<FilterChipDescriptor[]>(
    () =>
      buildActiveFilterChips({
        search,
        colorFilter,
        colorMode,
        rarityExpr,
        supertypeExpr,
        typesExpr,
        subtypeExpr,
        oracleExpr,
        oracleTagExpr,
        scryfallQuery,
        legalityExpr,
        layoutExpr,
        treatmentExpr,
        borderExpr,
        finishExpr,
        conditionExpr,
        languageExpr,
        binderExpr,
        setFilter,
        priceMin,
        priceMax,
        cmcMin,
        cmcMax,
        manaValues,
        manaSymbols,
        surplusOnly,
        proxyOnly,
        groupPrintings,
        EMPTY_EXPR,
        setSearch,
        setColorFilter,
        setRarityExpr,
        setSupertypeExpr,
        setTypesExpr,
        setSubtypeExpr,
        setOracleExpr,
        setOracleTagExpr,
        setScryfallQuery,
        setLegalityExpr,
        setLayoutExpr,
        setTreatmentExpr,
        setBorderExpr,
        setFinishExpr,
        setConditionExpr,
        setLanguageExpr,
        setBinderExpr,
        setSetFilter,
        setPriceMin,
        setPriceMax,
        setCmcMin,
        setCmcMax,
        setManaValues,
        setManaSymbols,
        setGroupPrintings,
        setSurplusOnly,
        setProxyOnly,
      }),
    [
      search,
      colorFilter,
      colorMode,
      rarityExpr,
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      conditionExpr,
      languageExpr,
      binderExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      manaValues,
      manaSymbols,
      surplusOnly,
      proxyOnly,
      groupPrintings,
      EMPTY_EXPR,
    ]
  );
  return {
    search,
    setSearch,
    debouncedSearch,
    activeFilterCount,
    clearAllFilters,
    structuredFilterActive,
    handleSaveAsBinderClick,
    activeFilterChips,
    fields: {
      supertypeExpr,
      setSupertypeExpr,
      typesExpr,
      setTypesExpr,
      subtypeExpr,
      setSubtypeExpr,
      rarityExpr,
      setRarityExpr,
      oracleExpr,
      setOracleExpr,
      oracleTagExpr,
      setOracleTagExpr,
      legalityExpr,
      setLegalityExpr,
      layoutExpr,
      setLayoutExpr,
      treatmentExpr,
      setTreatmentExpr,
      borderExpr,
      setBorderExpr,
      finishExpr,
      setFinishExpr,
      conditionExpr,
      setConditionExpr,
      languageExpr,
      setLanguageExpr,
      binderExpr,
      setBinderExpr,
      colorFilter,
      setColorFilter,
      colorMode,
      setColorMode,
      setFilter,
      setSetFilter,
      scryfallQuery,
      setScryfallQuery,
      priceMin,
      setPriceMin,
      priceMax,
      setPriceMax,
      cmcMin,
      setCmcMin,
      cmcMax,
      setCmcMax,
      manaValues,
      setManaValues,
      manaSymbols,
      setManaSymbols,
      groupPrintings,
      setGroupPrintings,
      surplusOnly,
      setSurplusOnly,
      proxyOnly,
      setProxyOnly,
    },
  };
}

export type CollectionFilters = ReturnType<typeof useCollectionFilters>;

/** The compiled matcher over `rows`: the BinderFilter built from the engine-
 *  mappable fields, plus the collection-only post-checks. */
export function useFilteredRows(
  rows: Row[],
  filters: CollectionFilters,
  surplusByName: Map<string, number>
): Row[] {
  const {
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    scryfallQuery,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    conditionExpr,
    languageExpr,
    binderExpr,
    colorFilter,
    colorMode,
    setFilter,
    priceMin,
    priceMax,
    cmcMin,
    cmcMax,
    manaValues,
    manaSymbols,
    surplusOnly,
    proxyOnly,
  } = filters.fields;
  const { debouncedSearch } = filters;

  // Binder membership and condition are collection-only post-checks that don't
  // map directly to BinderFilter fields, so they're compiled separately.
  const compiledBinder = useMemo(() => compileExpression(binderExpr), [binderExpr]);
  const compiledCondition = useMemo(() => compileExpression(conditionExpr), [conditionExpr]);
  const compiledLanguage = useMemo(() => compileExpression(languageExpr), [languageExpr]);

  // Build a BinderFilter from all the non-collection-specific filter state and
  // let the engine handle matching — eliminates the 11 individual compilations
  // and the hand-rolled per-field checks from the old filtered useMemo.
  const compiledMatchFilter = useMemo(
    () =>
      compileFilter(
        buildMatchFilter({
          supertypeExpr,
          typesExpr,
          subtypeExpr,
          rarityExpr,
          oracleExpr,
          oracleTagExpr,
          scryfallQuery,
          legalityExpr,
          layoutExpr,
          treatmentExpr,
          borderExpr,
          finishExpr,
          setFilter,
          priceMin,
          priceMax,
          cmcMin,
          cmcMax,
          manaValues,
          manaSymbols,
          debouncedSearch,
        })
      ),
    [
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      rarityExpr,
      oracleExpr,
      oracleTagExpr,
      scryfallQuery,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      setFilter,
      priceMin,
      priceMax,
      cmcMin,
      cmcMax,
      manaValues,
      manaSymbols,
      debouncedSearch,
    ]
  );

  // The predicate itself lives in lib/search/collection-filter so the Filters dialog
  // can run the identical thing over its DRAFT state for a live match count.
  const filterCriteria = useMemo(
    () => ({
      matchFilter: compiledMatchFilter,
      binder: compiledBinder,
      colors: colorFilter,
      colorMode,
      condition: compiledCondition,
      language: compiledLanguage,
      surplusOnly,
      surplusByName,
      proxyOnly,
    }),
    [
      compiledMatchFilter,
      compiledBinder,
      colorFilter,
      colorMode,
      compiledCondition,
      compiledLanguage,
      surplusOnly,
      surplusByName,
      proxyOnly,
    ]
  );

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesCollectionFilter(r, filterCriteria)),
    [rows, filterCriteria]
  );
  return filtered;
}

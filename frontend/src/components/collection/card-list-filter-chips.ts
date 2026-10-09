import type { ChipExpression, ScryfallQueryRule } from '@/types/index';
import { formatMoney } from '@/lib/collection/format-money';
import { LANGUAGE_OPTIONS } from '@/lib/collection/copy-options';
import { cardTagLabel } from '@/lib/cards/card-tags';
import { isExpressionEmpty } from '@spellcontrol/binder-routing';
import type { ColorMatchMode } from '@spellcontrol/binder-routing';
import type { FilterChipDescriptor } from '@/components/shared/FilterChipsRow';

// The active-filter chip descriptors for CardListTable, lifted out of its
// `activeFilterChips` memo (T176): the single place that maps filter state to
// human labels. Each chip knows how to clear its own slice, so the caller
// hands in the setters alongside the values.

export interface ActiveFilterChipsInput {
  search: string;
  colorFilter: Set<string>;
  colorMode: ColorMatchMode;
  rarityExpr: ChipExpression;
  supertypeExpr: ChipExpression;
  typesExpr: ChipExpression;
  subtypeExpr: ChipExpression;
  oracleExpr: ChipExpression;
  oracleTagExpr: ChipExpression;
  scryfallQuery: ScryfallQueryRule | undefined;
  legalityExpr: ChipExpression;
  layoutExpr: ChipExpression;
  treatmentExpr: ChipExpression;
  borderExpr: ChipExpression;
  finishExpr: ChipExpression;
  conditionExpr: ChipExpression;
  languageExpr: ChipExpression;
  binderExpr: ChipExpression;
  setFilter: Set<string>;
  priceMin: number | undefined;
  priceMax: number | undefined;
  cmcMin: number | undefined;
  cmcMax: number | undefined;
  surplusOnly: boolean;
  proxyOnly: boolean;
  groupPrintings: boolean;
  /** The shared empty expression the chip clears reset to. */
  EMPTY_EXPR: ChipExpression;
  setSearch: (v: string) => void;
  setColorFilter: (v: Set<string>) => void;
  setRarityExpr: (v: ChipExpression) => void;
  setSupertypeExpr: (v: ChipExpression) => void;
  setTypesExpr: (v: ChipExpression) => void;
  setSubtypeExpr: (v: ChipExpression) => void;
  setOracleExpr: (v: ChipExpression) => void;
  setOracleTagExpr: (v: ChipExpression) => void;
  setScryfallQuery: (v: ScryfallQueryRule | undefined) => void;
  setLegalityExpr: (v: ChipExpression) => void;
  setLayoutExpr: (v: ChipExpression) => void;
  setTreatmentExpr: (v: ChipExpression) => void;
  setBorderExpr: (v: ChipExpression) => void;
  setFinishExpr: (v: ChipExpression) => void;
  setConditionExpr: (v: ChipExpression) => void;
  setLanguageExpr: (v: ChipExpression) => void;
  setBinderExpr: (v: ChipExpression) => void;
  setSetFilter: (v: Set<string>) => void;
  setPriceMin: (v: number | undefined) => void;
  setPriceMax: (v: number | undefined) => void;
  setCmcMin: (v: number | undefined) => void;
  setCmcMax: (v: number | undefined) => void;
  setGroupPrintings: (v: boolean) => void;
  setSurplusOnly: (v: boolean) => void;
  setProxyOnly: (v: boolean) => void;
}

export function buildActiveFilterChips(input: ActiveFilterChipsInput): FilterChipDescriptor[] {
  const {
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
    setGroupPrintings,
    setSurplusOnly,
    setProxyOnly,
  } = input;
  const chips: FilterChipDescriptor[] = [];

  if (search.trim()) {
    chips.push({
      id: 'search',
      label: `"${search.trim()}"`,
      onClear: () => setSearch(''),
    });
  }
  if (colorFilter.size > 0) {
    const colorMap: Record<string, string> = {
      W: 'White',
      U: 'Blue',
      B: 'Black',
      R: 'Red',
      G: 'Green',
      C: 'Colorless',
    };
    // AND mode reads as an intersection — "White + Red" — vs OR's list.
    const labels = [...colorFilter]
      .map((k) => colorMap[k] ?? k)
      .join(colorMode === 'all' ? ' + ' : ', ');
    chips.push({
      id: 'color',
      label: `Color: ${labels}`,
      onClear: () => setColorFilter(new Set()),
    });
  }
  if (!isExpressionEmpty(rarityExpr)) {
    const labels = rarityExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not ${c.value}` : c.value))
      .join(', ');
    chips.push({
      id: 'rarity',
      label: `Rarity: ${labels}`,
      onClear: () => setRarityExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(supertypeExpr)) {
    const labels = supertypeExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not ${c.value}` : c.value))
      .join(', ');
    chips.push({
      id: 'supertype',
      label: `Supertype: ${labels}`,
      onClear: () => setSupertypeExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(typesExpr)) {
    const labels = typesExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not ${c.value}` : c.value))
      .join(', ');
    chips.push({
      id: 'type',
      label: `Type: ${labels}`,
      onClear: () => setTypesExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(subtypeExpr)) {
    const labels = subtypeExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not ${c.value}` : c.value))
      .join(', ');
    chips.push({
      id: 'subtype',
      label: `Subtype: ${labels}`,
      onClear: () => setSubtypeExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(oracleExpr)) {
    const labels = oracleExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not "${c.value}"` : `"${c.value}"`))
      .join(', ');
    chips.push({
      id: 'oracle',
      label: `Text: ${labels}`,
      onClear: () => setOracleExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(oracleTagExpr)) {
    const labels = oracleTagExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => (c.negate ? `not ${cardTagLabel(c.value)}` : cardTagLabel(c.value)))
      .join(', ');
    chips.push({
      id: 'oracleTag',
      label: `Tags: ${labels}`,
      onClear: () => setOracleTagExpr(EMPTY_EXPR),
    });
  }
  if (scryfallQuery) {
    chips.push({
      id: 'scryfallQuery',
      label: `Scryfall: ${scryfallQuery.query}`,
      onClear: () => setScryfallQuery(undefined),
    });
  }
  if (!isExpressionEmpty(legalityExpr)) {
    const labels = legalityExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'legality',
      label: `Legal in: ${labels}`,
      onClear: () => setLegalityExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(layoutExpr)) {
    const labels = layoutExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'layout',
      label: `Layout: ${labels}`,
      onClear: () => setLayoutExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(treatmentExpr)) {
    const labels = treatmentExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'treatment',
      label: `Treatment: ${labels}`,
      onClear: () => setTreatmentExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(borderExpr)) {
    const labels = borderExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'border',
      label: `Border: ${labels}`,
      onClear: () => setBorderExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(finishExpr)) {
    const labels = finishExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'finish',
      label: `Finish: ${labels}`,
      onClear: () => setFinishExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(conditionExpr)) {
    const labels = conditionExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'condition',
      label: `Condition: ${labels}`,
      onClear: () => setConditionExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(languageExpr)) {
    const labels = languageExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => String(LANGUAGE_OPTIONS.find((o) => o.value === c.value)?.label ?? c.value))
      .join(', ');
    chips.push({
      id: 'language',
      label: `Language: ${labels}`,
      onClear: () => setLanguageExpr(EMPTY_EXPR),
    });
  }
  if (!isExpressionEmpty(binderExpr)) {
    const labels = binderExpr.chips
      .filter((c) => c.value.trim())
      .map((c) => c.value)
      .join(', ');
    chips.push({
      id: 'binder',
      label: `Binder: ${labels}`,
      onClear: () => setBinderExpr(EMPTY_EXPR),
    });
  }
  if (setFilter.size > 0) {
    const labels = [...setFilter].join(', ');
    chips.push({
      id: 'set',
      label: `Set: ${labels}`,
      onClear: () => setSetFilter(new Set()),
    });
  }
  if (priceMin !== undefined || priceMax !== undefined) {
    const label =
      priceMin !== undefined && priceMax !== undefined
        ? `Price: ${formatMoney(priceMin)}–${formatMoney(priceMax)}`
        : priceMin !== undefined
          ? `Price: ≥ ${formatMoney(priceMin)}`
          : `Price: ≤ ${formatMoney(priceMax)}`;
    chips.push({
      id: 'price',
      label,
      onClear: () => {
        setPriceMin(undefined);
        setPriceMax(undefined);
      },
    });
  }
  if (cmcMin !== undefined || cmcMax !== undefined) {
    const label =
      cmcMin !== undefined && cmcMax !== undefined
        ? `Mana value: ${cmcMin}–${cmcMax}`
        : cmcMin !== undefined
          ? `Mana value: ≥ ${cmcMin}`
          : `Mana value: ≤ ${cmcMax}`;
    chips.push({
      id: 'cmc',
      label,
      onClear: () => {
        setCmcMin(undefined);
        setCmcMax(undefined);
      },
    });
  }
  if (!groupPrintings) {
    chips.push({
      id: 'groupPrintings',
      label: 'All copies shown',
      onClear: () => setGroupPrintings(true),
    });
  }
  if (surplusOnly) {
    chips.push({
      id: 'surplus',
      label: 'Surplus only',
      onClear: () => setSurplusOnly(false),
    });
  }
  if (proxyOnly) {
    chips.push({
      id: 'proxy',
      label: 'Proxies only',
      onClear: () => setProxyOnly(false),
    });
  }
  return chips;
}

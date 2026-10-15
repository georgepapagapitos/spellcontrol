import { ListFilter, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  BinderFilter,
  ChipExpression,
  Condition,
  MaterializedBinder,
  ScryfallQueryRule,
} from '@/types/index';
import type { SetMap } from '@/lib/api';
import { Modal } from '@/components/overlays/Modal';
import { SetFilterPicker, setMapToOptions } from './SetFilterPicker';
import { Disclosure, Field, SwitchRow } from '@/components/shared/form';
import type { FilterableRow } from '@/lib/search/collection-filter';
import {
  COLOR_MATCH_MODES,
  TYPES,
  normalizeManaSymbolQuery,
  normalizeManaValues,
  type ColorMatchMode,
} from '@spellcontrol/binder-routing';
import {
  collectionFiltersToFilterGroup,
  deriveBinderName,
  hasStructuredFilter,
} from '@/lib/search/collection-filters-to-binder';
import type { FilterFieldGroup } from '@/lib/search/filter-fields';
import {
  ActiveFilterStrip,
  ChoiceChips,
  EMPTY_MANA_COST,
  EMPTY_VALUE_STRIP,
  FilterSection,
  ManaColorPicker,
  ManaSymbolPad,
  PresetRange,
  ShowResultsButton,
  ValueStrip,
  colorModeHint,
  colorModeOptions,
  isValueStripRange,
  manaCostCount,
  valueStripCount,
  type RangePreset,
  type ValueStripValue,
} from '@/components/filter-kit';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { TypeLineExpressionBuilder } from './TypeLineExpressionBuilder';
import { FilterFieldEditor } from './FilterFieldEditor';
import {
  EMPTY_EXPR,
  countDraft,
  draftChips,
  emptyDraft,
  singleBlockingFilter,
  type FilterDraft,
} from './collection-filters-draft';
import { useCollectionStore } from '@/store/collection';
import { Button, IconButton } from '@/components/shared/Button';
import { Count } from '@/components/shared/Count';

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'nm', label: 'Near Mint' },
  { value: 'lp', label: 'Lightly Played' },
  { value: 'mp', label: 'Moderately Played' },
  { value: 'hp', label: 'Heavily Played' },
  { value: 'damaged', label: 'Damaged' },
];

interface Props {
  supertypeExpr: ChipExpression;
  setSupertypeExpr: (next: ChipExpression) => void;
  typesExpr: ChipExpression;
  setTypesExpr: (next: ChipExpression) => void;
  subtypeExpr: ChipExpression;
  setSubtypeExpr: (next: ChipExpression) => void;
  subtypeSuggestions: string[];

  colorFilter: Set<string>;
  setColorFilter: (next: Set<string>) => void;
  /** How the picked colors match: any of them, exactly them, or within them. */
  colorMode: ColorMatchMode;
  setColorMode: (next: ColorMatchMode) => void;

  rarityExpr: ChipExpression;
  setRarityExpr: (next: ChipExpression) => void;
  rarities: readonly string[];

  /**
   * Free-text oracle (rules) text search. Substring match, IS / IS NOT
   * per chip, AND/OR between chips — so "draw a card" AND "{T}" composes.
   */
  oracleExpr: ChipExpression;
  setOracleExpr: (next: ChipExpression) => void;

  /**
   * Oracle tag (Scryfall otag) filter — collection-page-only. Matches against
   * `card.tags` decorated from the bundled tagger snapshot. The deck-editor
   * card search omits these props (its cards aren't tag-decorated) so the row
   * disappears, same pattern as Finish/Binder.
   */
  oracleTagExpr?: ChipExpression;
  setOracleTagExpr?: (next: ChipExpression) => void;

  /**
   * Free-text Scryfall query snapshot-resolved to oracle ids. Omitted by
   * surfaces that should not hit the live Scryfall search API from filters.
   */
  scryfallQuery?: ScryfallQueryRule;
  setScryfallQuery?: (next: ScryfallQueryRule | undefined) => void;

  legalityExpr: ChipExpression;
  setLegalityExpr: (next: ChipExpression) => void;

  layoutExpr: ChipExpression;
  setLayoutExpr: (next: ChipExpression) => void;

  treatmentExpr: ChipExpression;
  setTreatmentExpr: (next: ChipExpression) => void;

  borderExpr: ChipExpression;
  setBorderExpr: (next: ChipExpression) => void;

  /**
   * Finish + condition describe the *physical copy* owned, so they're
   * collection-page-only — the deck-editor card search omits these props
   * and the sections disappear (same pattern as the Binder section).
   */
  finishExpr?: ChipExpression;
  setFinishExpr?: (next: ChipExpression) => void;
  conditionExpr?: ChipExpression;
  setConditionExpr?: (next: ChipExpression) => void;

  /**
   * Printed-language filter — collection-page-only (physical-copy field,
   * same convention as Condition). `languages` is derived from what's
   * actually in the user's collection, not a fixed enum — see CardListTable.
   */
  languageExpr?: ChipExpression;
  setLanguageExpr?: (next: ChipExpression) => void;
  languages?: Array<{ value: string; label: string }>;

  /**
   * Binder section is collection-page-only. The deck-editor card search
   * doesn't have a binder concept, so it omits all three of these props
   * and the Binder section disappears entirely.
   */
  binderExpr?: ChipExpression;
  setBinderExpr?: (next: ChipExpression) => void;
  binders?: MaterializedBinder[];
  /** Force-hide binder section even when state is wired (binder-scoped views). */
  hideBinderFilter?: boolean;

  /**
   * Content facets that need Scryfall fields not every consumer carries. Default
   * true (collection cards are fully enriched); shared views pass false because
   * the slim public payload lacks oracleText / legalities / frameEffects /
   * borderColor. Forwarded to FilterFieldEditor.
   */
  showOracleText?: boolean;
  showLegality?: boolean;
  showTreatment?: boolean;
  showBorder?: boolean;
  /** Layout and Set need `layout` / `setCode` on the card. A friend's
   *  collection payload carries neither (public card facts only), so its
   *  browser hides both rows rather than offering facets that match nothing. */
  showLayout?: boolean;
  showSet?: boolean;

  setFilter: Set<string>;
  setSetFilter: (next: Set<string>) => void;
  setMap?: SetMap;

  /**
   * Price range filter — collection-page-only. purchasePrice === 0 means
   * "no price recorded" and is always excluded from price-constrained results.
   * Either bound is optional: min-only = "≥ X", max-only = "≤ X".
   */
  priceMin?: number;
  setPriceMin?: (v: number | undefined) => void;
  priceMax?: number;
  setPriceMax?: (v: number | undefined) => void;

  /**
   * Mana value (CMC) range filter — collection-page-only. cmc === undefined
   * means unknown and is always excluded from CMC-constrained results.
   * Either bound is optional: min-only = "≥ X", max-only = "≤ X".
   */
  cmcMin?: number;
  setCmcMin?: (v: number | undefined) => void;
  cmcMax?: number;
  setCmcMax?: (v: number | undefined) => void;
  /**
   * Mana value chips (exact values plus an open "N and up"); the strip's
   * Custom… comparator writes cmcMin/cmcMax instead. The section needs both
   * pairs wired, so a surface passes them together.
   */
  manaValues?: BinderFilter['manaValues'];
  setManaValues?: (v: BinderFilter['manaValues']) => void;

  /** Printed mana-cost symbols (the pad under More filters). Omit the pair to hide the pad. */
  manaSymbols?: BinderFilter['manaSymbols'];
  setManaSymbols?: (v: BinderFilter['manaSymbols']) => void;

  /**
   * Tradeable-surplus filter — collection-page-only (needs deck/cube
   * allocation data the deck-editor card search doesn't have). Omit both
   * props to hide the section entirely, same convention as proxyOnly.
   */
  surplusOnly?: boolean;
  setSurplusOnly?: (next: boolean) => void;

  /**
   * Proxy filter — same optional-pair convention as surplusOnly:
   * omit both props to hide the section entirely.
   */
  proxyOnly?: boolean;
  setProxyOnly?: (next: boolean) => void;

  /**
   * The rows the page is filtering. Optional so callers that don't have them
   * (or don't want the cost) simply get no count, as before.
   */
  rows?: readonly FilterableRow[];
  surplusByName?: ReadonlySet<string> | Map<string, unknown>;
  /** The page's search box — outside this dialog, but narrows the same list. */
  searchTerm?: string;
  activeCount: number;
}

/**
 * The collection Filters dialog, built on the filter kit (STYLE_GUIDE § Filter
 * kit): the questions people ask most sit up front (color, card type, mana
 * value, rarity, set, rules text) and everything else is behind "More filters",
 * which opens itself when something inside is on. Triggered by the filter icon
 * in the search pill; renders into a portal over the whole app. A centered
 * dialog on desktop, a bottom sheet on a phone.
 *
 * Edits are a DRAFT until **Show N cards**: picking chips, flipping joiners and
 * toggling colors all mutate state inside the dialog, and the committed filters
 * change only when the person shows the results. **Clear** wipes the draft but
 * leaves the dialog open; the close ×, the backdrop and Escape dismiss without
 * committing. Why deferred: live-applying every tap made the card list thrash
 * and re-sort behind the dialog, which was distracting and slow on a large
 * collection.
 */
export function CollectionFiltersDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const hasActive = props.activeCount > 0;

  return (
    <>
      <button
        type="button"
        className="filter-popover-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `Filters (${props.activeCount} active)` : 'Filters'}
        title="Filters"
        onClick={() => setOpen(true)}
      >
        <ListFilter width={16} height={16} strokeWidth={2} aria-hidden />
        <Count
          className="collection-filters-badge"
          tone="accent"
          value={props.activeCount}
          placement="corner"
        />
      </button>
      {open &&
        createPortal(<DialogBody {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const exprCount = (e: ChipExpression) => e.chips.filter((c) => c.value.trim()).length;

/**
 * Toggle one value in a chip expression the way a chip row means it: pressed
 * adds it (joined by `joiner`), pressed again removes it and the joiner beside
 * it. A value already there as IS NOT flips to IS rather than doubling.
 */
function toggleChip(expr: ChipExpression, value: string, joiner: 'AND' | 'OR'): ChipExpression {
  const i = expr.chips.findIndex((c) => c.value.toLowerCase() === value.toLowerCase());
  if (i >= 0 && expr.chips[i].negate) {
    return { ...expr, chips: expr.chips.map((c, k) => (k === i ? { ...c, negate: false } : c)) };
  }
  if (i >= 0) {
    const chips = expr.chips.filter((_, k) => k !== i);
    const drop = i < expr.joiners.length ? i : i - 1;
    return { chips, joiners: chips.length === 0 ? [] : expr.joiners.filter((_, k) => k !== drop) };
  }
  return {
    chips: [...expr.chips, { value, negate: false }],
    joiners: expr.chips.length === 0 ? [] : [...expr.joiners, joiner],
  };
}

const chipValues = (e: ChipExpression) =>
  e.chips.filter((c) => !c.negate).map((c) => c.value.toLowerCase());

/** ChoiceChips reports the whole next selection; this turns the one value that changed into a toggle. */
function applyChoice(expr: ChipExpression, next: readonly string[]): ChipExpression {
  const now = chipValues(expr);
  const changed = next.find((v) => !now.includes(v)) ?? now.find((v) => !next.includes(v));
  return changed === undefined ? expr : toggleChip(expr, changed, 'OR');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The eight everyday types, in the order people name them. The engine's TYPES
// also holds Tribal, which has no use as a chip; the type search still takes it.
const TYPE_CHIPS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
] as const satisfies readonly (typeof TYPES)[number][];
const TYPE_OPTIONS = TYPE_CHIPS.map((t) => ({ value: t, label: cap(t) }));
const MODE_OPTIONS = colorModeOptions(COLOR_MATCH_MODES);

const PRICE_PRESETS: RangePreset[] = [
  { label: 'Under $1', max: 1 },
  { label: '$1–$5', min: 1, max: 5 },
  { label: '$5–$20', min: 5, max: 20 },
  { label: '$20+', min: 20 },
];

/**
 * The mounted-while-open body. Splitting this out lets `useState`
 * initializers seed the draft from current props on each open — no
 * effect-driven sync needed, no stale draft after close+reopen.
 */
function DialogBody(props: Props & { onClose: () => void }) {
  const {
    subtypeSuggestions,
    rarities,
    showOracleText = true,
    showLegality = true,
    showTreatment = true,
    showBorder = true,
    showLayout = true,
    showSet = true,
    setMap,
    binders,
    languages,
    hideBinderFilter,
    rows,
    surplusByName,
    searchTerm,
    onClose,
  } = props;

  const showBinder = props.binderExpr !== undefined && !hideBinderFilter;
  const showOracleTags = props.oracleTagExpr !== undefined;
  const showScryfallQuery = props.setScryfallQuery !== undefined;
  const showSurplus = props.setSurplusOnly !== undefined;
  const showProxy = props.setProxyOnly !== undefined;
  const showFinish = props.finishExpr !== undefined;
  const showCondition = props.conditionExpr !== undefined;
  const showLanguage = props.languageExpr !== undefined;
  const showPrice = props.setPriceMin !== undefined || props.setPriceMax !== undefined;
  const showCmc = props.setCmcMin !== undefined || props.setCmcMax !== undefined;
  // The strip needs both its chips and its Custom… comparator to commit.
  const showMv = showCmc && props.setManaValues !== undefined;
  const showManaCost = props.setManaSymbols !== undefined;

  // Draft state, seeded once from props on mount; this component is remounted
  // on every open, so the snapshot stays fresh.
  const [d, setD] = useState<FilterDraft>(() => ({
    supertype: props.supertypeExpr,
    types: props.typesExpr,
    subtype: props.subtypeExpr,
    color: new Set(props.colorFilter),
    colorMode: props.colorMode,
    rarity: props.rarityExpr,
    oracle: props.oracleExpr,
    oracleTag: props.oracleTagExpr ?? EMPTY_EXPR,
    scryfallQuery: props.scryfallQuery,
    legality: props.legalityExpr,
    layout: props.layoutExpr,
    treatment: props.treatmentExpr,
    border: props.borderExpr,
    finish: props.finishExpr ?? EMPTY_EXPR,
    condition: props.conditionExpr ?? EMPTY_EXPR,
    language: props.languageExpr ?? EMPTY_EXPR,
    binder: props.binderExpr ?? EMPTY_EXPR,
    setFilter: new Set(props.setFilter),
    priceMin: props.priceMin,
    priceMax: props.priceMax,
    cmcMin: props.cmcMin,
    cmcMax: props.cmcMax,
    manaValues: props.manaValues,
    manaSymbols: props.manaSymbols,
    surplusOnly: props.surplusOnly ?? false,
    proxyOnly: props.proxyOnly ?? false,
  }));
  const patch = useCallback((p: Partial<FilterDraft>) => setD((prev) => ({ ...prev, ...p })), []);
  // Whether the mana value strip shows its chips or its Custom… comparator.
  const [mvRange, setMvRange] = useState(props.cmcMin !== undefined || props.cmcMax !== undefined);

  const setOptions = useMemo(() => setMapToOptions(setMap), [setMap]);

  // Fields a surface did not wire stay at their defaults in the draft, so the
  // counts and chips below only ever look at what the dialog actually shows.
  const chips = draftChips(d, patch);
  const draftHasAny = chips.length > 0;

  const mvValue: ValueStripValue = mvRange
    ? { min: d.cmcMin, max: d.cmcMax }
    : (d.manaValues ?? EMPTY_VALUE_STRIP);

  const moreCount =
    (showManaCost ? manaCostCount(d.manaSymbols ?? EMPTY_MANA_COST) : 0) +
    (showLegality ? exprCount(d.legality) : 0) +
    (showPrice && (d.priceMin !== undefined || d.priceMax !== undefined) ? 1 : 0) +
    (showFinish ? exprCount(d.finish) : 0) +
    (showTreatment ? exprCount(d.treatment) : 0) +
    (showLayout ? exprCount(d.layout) : 0) +
    (showBorder ? exprCount(d.border) : 0) +
    (showOracleTags ? exprCount(d.oracleTag) : 0) +
    (showScryfallQuery && d.scryfallQuery ? 1 : 0) +
    (showCondition ? exprCount(d.condition) : 0) +
    (showLanguage ? exprCount(d.language) : 0) +
    (showBinder ? exprCount(d.binder) : 0) +
    (showSurplus && d.surplusOnly ? 1 : 0) +
    (showProxy && d.proxyOnly ? 1 : 0);
  // Opens itself when the dialog opens onto something already set in it.
  const [moreOpenAtStart] = useState(moreCount > 0);

  // Live match count over the DRAFT, using the same predicate the page runs.
  // The page's search box is outside this dialog but narrows the same list, so
  // the count honors it or it would not match what Show produces.
  const ctx = useMemo(
    () => (rows ? { rows, surplusByName, searchTerm } : null),
    [rows, surplusByName, searchTerm]
  );
  const draftMatchCount = useMemo(() => (ctx ? countDraft(d, ctx) : null), [ctx, d]);
  const blocking = useMemo(
    () => (ctx && draftMatchCount === 0 ? singleBlockingFilter(d, ctx) : null),
    [ctx, d, draftMatchCount]
  );

  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);

  // What "Save as a binder…" seeds from — the DRAFT, not the applied filters,
  // so it captures whatever is on screen even before Show. Condition,
  // language and binder membership can't map to a binder rule (no physical-
  // copy or membership concept there); collectionFiltersToFilterGroup flags
  // those, and BinderEditor's own seed note explains the gap.
  const saveAsBinderInput = {
    colorFilter: d.color,
    colorMode: d.colorMode,
    proxyOnly: showProxy && d.proxyOnly,
    surplusOnly: showSurplus && d.surplusOnly,
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
    search: searchTerm ?? '',
  };
  const canSaveAsBinder = hasStructuredFilter(saveAsBinderInput);
  const saveAsBinder = () => {
    const { group, flagged } = collectionFiltersToFilterGroup(saveAsBinderInput);
    const name = deriveBinderName(saveAsBinderInput);
    setEditingBinder('new', { name, groups: [group], flagged });
    onClose();
  };

  const apply = () => {
    props.setSupertypeExpr(d.supertype);
    props.setTypesExpr(d.types);
    props.setSubtypeExpr(d.subtype);
    props.setColorFilter(d.color);
    props.setColorMode(d.colorMode);
    props.setRarityExpr(d.rarity);
    props.setOracleExpr(d.oracle);
    if (showOracleTags) props.setOracleTagExpr?.(d.oracleTag);
    if (showScryfallQuery) props.setScryfallQuery?.(d.scryfallQuery);
    props.setLegalityExpr(d.legality);
    props.setLayoutExpr(d.layout);
    props.setTreatmentExpr(d.treatment);
    props.setBorderExpr(d.border);
    if (showFinish) props.setFinishExpr?.(d.finish);
    if (showCondition) props.setConditionExpr?.(d.condition);
    if (showLanguage) props.setLanguageExpr?.(d.language);
    if (showBinder) props.setBinderExpr?.(d.binder);
    props.setSetFilter(d.setFilter);
    if (showPrice) {
      props.setPriceMin?.(d.priceMin);
      props.setPriceMax?.(d.priceMax);
    }
    if (showCmc) {
      props.setCmcMin?.(d.cmcMin);
      props.setCmcMax?.(d.cmcMax);
    }
    if (showMv) props.setManaValues?.(normalizeManaValues(d.manaValues));
    if (showManaCost) props.setManaSymbols?.(normalizeManaSymbolQuery(d.manaSymbols));
    if (showSurplus) props.setSurplusOnly?.(d.surplusOnly);
    if (showProxy) props.setProxyOnly?.(d.proxyOnly);
    onClose();
  };

  const clearDraft = () => {
    setD(emptyDraft());
    setMvRange(false);
  };

  // The registry-driven rows (format, layout, finish, tags, Scryfall query)
  // still come from FilterFieldEditor; each call turns on only the fields it
  // is for, so the dialog decides where they sit.
  const asFilter: BinderFilter = {
    oracleChips: d.oracle,
    oracleTagChips: d.oracleTag,
    scryfallQuery: d.scryfallQuery,
    legalities: d.legality,
    layouts: d.layout,
    treatments: d.treatment,
    borderColors: d.border,
    finishes: d.finish,
  };
  const onFilterPatch = (p: Partial<BinderFilter>) => {
    const next: Partial<FilterDraft> = {};
    if (p.oracleChips !== undefined) next.oracle = p.oracleChips;
    if (p.oracleTagChips !== undefined) next.oracleTag = p.oracleTagChips;
    if ('scryfallQuery' in p) next.scryfallQuery = p.scryfallQuery;
    if (p.legalities !== undefined) next.legality = p.legalities;
    if (p.layouts !== undefined) next.layout = p.layouts;
    if (p.treatments !== undefined) next.treatment = p.treatments;
    if (p.borderColors !== undefined) next.border = p.borderColors;
    if (p.finishes !== undefined) next.finish = p.finishes;
    patch(next);
  };
  const none = {
    showOracleText: false,
    showLegality: false,
    showTreatment: false,
    showBorder: false,
    showLayout: false,
    showOracleTags: false,
    showScryfallQuery: false,
    showFinish: false,
  };
  const fieldEditor = (group: FilterFieldGroup, on: Partial<typeof none>) => (
    <FilterFieldEditor
      value={asFilter}
      onPatch={onFilterPatch}
      variant="dialog"
      group={group}
      {...none}
      {...on}
    />
  );

  const colors = [...d.color];
  const typeCount = exprCount(d.types) + exprCount(d.supertype) + exprCount(d.subtype);
  const hasCopyGroup = showCondition || showLanguage || showBinder || showSurplus || showProxy;

  return (
    // The shared Modal supplies the backdrop, entrance/exit motion, focus
    // trap, Escape handling, and body scroll lock. On a phone the same dialog
    // is a bottom sheet (`modal-backdrop--sheet`, Pattern B).
    <Modal
      onClose={onClose}
      label="Collection filters"
      className="collection-filters-dialog"
      backdropClassName="modal-backdrop--over-sheet modal-backdrop--sheet"
    >
      <span className="collection-filters-dialog-grabber" aria-hidden="true" />
      <header className="collection-filters-dialog-header">
        <span className="collection-filters-dialog-title">Filters</span>
        <IconButton
          variant="quiet"
          onClick={onClose}
          title="Close without applying"
          label="Close filters without applying"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </header>

      {chips.length > 0 && (
        <div className="collection-filters-dialog-active">
          <ActiveFilterStrip chips={chips} onClearAll={clearDraft} />
        </div>
      )}

      <div className="collection-filters-dialog-body">
        <FilterSection label="Color" count={d.color.size}>
          <ManaColorPicker
            colors={colors}
            onColorsChange={(next) => patch({ color: new Set(next) })}
            mode={d.colorMode}
            modes={MODE_OPTIONS}
            onModeChange={(colorMode) => patch({ colorMode })}
            hint={colorModeHint(colors, d.colorMode)}
          />
        </FilterSection>

        <FilterSection label="Card type" count={typeCount}>
          <ChoiceChips
            multiple
            ariaLabel="Filter by card type"
            options={TYPE_OPTIONS}
            value={chipValues(d.types)}
            onChange={(next) => patch({ types: applyChoice(d.types, next) })}
          />
          <Field label="Subtype or supertype">
            <TypeLineExpressionBuilder
              supertypeExpr={d.supertype}
              setSupertypeExpr={(supertype) => patch({ supertype })}
              typesExpr={d.types}
              setTypesExpr={(types) => patch({ types })}
              subtypeExpr={d.subtype}
              setSubtypeExpr={(subtype) => patch({ subtype })}
              subtypeSuggestions={subtypeSuggestions}
              hideSimpleTypeRow
              placeholder="Search: Angel, Legendary, Equipment…"
              inputAriaLabel="Search subtypes and supertypes"
            />
          </Field>
        </FilterSection>

        {showMv && (
          <FilterSection label="Mana value" count={valueStripCount(mvValue)}>
            <ValueStrip
              ariaLabel="Filter by mana value"
              valueLabel="Mana value"
              value={mvValue}
              onChange={(next) => {
                if (isValueStripRange(next)) {
                  setMvRange(true);
                  patch({ cmcMin: next.min, cmcMax: next.max, manaValues: undefined });
                } else {
                  setMvRange(false);
                  patch({
                    cmcMin: undefined,
                    cmcMax: undefined,
                    manaValues:
                      next.values.length > 0 || next.atLeast !== undefined ? next : undefined,
                  });
                }
              }}
            />
          </FilterSection>
        )}

        <FilterSection label="Rarity" count={exprCount(d.rarity)}>
          <ChoiceChips
            multiple
            ariaLabel="Filter by rarity"
            options={rarities.map((r) => ({ value: r, label: cap(r) }))}
            value={chipValues(d.rarity)}
            onChange={(next) => patch({ rarity: applyChoice(d.rarity, next) })}
          />
        </FilterSection>

        {showSet && (
          <FilterSection label="Set" count={d.setFilter.size}>
            <SetFilterPicker
              options={setOptions}
              value={d.setFilter}
              onChange={(setFilter) => patch({ setFilter })}
            />
          </FilterSection>
        )}

        {showOracleText && (
          <FilterSection label="Rules text" count={exprCount(d.oracle)}>
            <ChipExpressionBuilder
              value={d.oracle}
              onChange={(oracle) => patch({ oracle })}
              suggestions={[]}
              defaultJoiner="OR"
              placeholder="flying, draw a card…"
            />
          </FilterSection>
        )}

        <Disclosure
          title="More filters"
          summary={moreCount > 0 ? `${moreCount} on` : 'Mana cost, format, price, finish, tags'}
          defaultOpen={moreOpenAtStart}
        >
          <div className="collection-filters-more">
            {showManaCost && (
              <FilterSection
                label="Mana cost"
                count={manaCostCount(d.manaSymbols ?? EMPTY_MANA_COST)}
              >
                <ManaSymbolPad
                  value={d.manaSymbols ?? EMPTY_MANA_COST}
                  onChange={(manaSymbols) => patch({ manaSymbols })}
                />
              </FilterSection>
            )}

            {showLegality && (
              <FilterSection label="Format" count={exprCount(d.legality)}>
                {fieldEditor('Value & play', { showLegality: true })}
              </FilterSection>
            )}

            {showPrice && (
              <FilterSection
                label="Price"
                count={d.priceMin !== undefined || d.priceMax !== undefined ? 1 : 0}
              >
                <PresetRange
                  ariaLabel="Filter by price"
                  valueLabel="Price"
                  prefix="$"
                  step={0.01}
                  presets={PRICE_PRESETS}
                  value={{ min: d.priceMin, max: d.priceMax }}
                  onChange={(r) => patch({ priceMin: r.min, priceMax: r.max })}
                />
              </FilterSection>
            )}

            {(showFinish || showTreatment || showLayout || showBorder) && (
              <FilterSection
                label="Finish and layout"
                count={
                  (showFinish ? exprCount(d.finish) : 0) +
                  (showTreatment ? exprCount(d.treatment) : 0) +
                  (showLayout ? exprCount(d.layout) : 0) +
                  (showBorder ? exprCount(d.border) : 0)
                }
              >
                {fieldEditor('Printing', {
                  showFinish,
                  showTreatment,
                  showLayout,
                  showBorder,
                })}
              </FilterSection>
            )}

            {(showOracleTags || showScryfallQuery) && (
              <FilterSection
                label="Tags and queries"
                count={
                  (showOracleTags ? exprCount(d.oracleTag) : 0) +
                  (showScryfallQuery && d.scryfallQuery ? 1 : 0)
                }
              >
                {fieldEditor('Text', { showOracleTags, showScryfallQuery })}
              </FilterSection>
            )}

            {hasCopyGroup && (
              <FilterSection
                label="This copy"
                count={
                  (showCondition ? exprCount(d.condition) : 0) +
                  (showLanguage ? exprCount(d.language) : 0) +
                  (showBinder ? exprCount(d.binder) : 0) +
                  (showSurplus && d.surplusOnly ? 1 : 0) +
                  (showProxy && d.proxyOnly ? 1 : 0)
                }
              >
                {showCondition && (
                  <Field label="Condition">
                    <ChipExpressionBuilder
                      value={d.condition}
                      onChange={(condition) => patch({ condition })}
                      options={CONDITIONS}
                      defaultJoiner="OR"
                      lockJoiner="OR"
                      placeholder="Add condition…"
                    />
                  </Field>
                )}
                {showLanguage && (
                  <Field label="Language">
                    <ChipExpressionBuilder
                      value={d.language}
                      onChange={(language) => patch({ language })}
                      options={languages ?? []}
                      defaultJoiner="OR"
                      lockJoiner="OR"
                      placeholder="Add language…"
                    />
                  </Field>
                )}
                {showBinder && (
                  <Field label="Binder">
                    <ChipExpressionBuilder
                      value={d.binder}
                      onChange={(binder) => patch({ binder })}
                      options={[
                        ...(binders ?? []).map((b) => ({ value: b.def.name, label: b.def.name })),
                        { value: '__uncategorized', label: 'Uncategorized' },
                      ]}
                      defaultJoiner="OR"
                      lockJoiner="OR"
                      placeholder="Add binder…"
                    />
                  </Field>
                )}
                {showSurplus && (
                  <SwitchRow
                    label="Tradeable surplus only"
                    hint="Copies beyond the priciest one you keep of each card. Copies in a deck or cube and basic lands never count."
                    checked={d.surplusOnly}
                    onChange={(surplusOnly) => patch({ surplusOnly })}
                  />
                )}
                {showProxy && (
                  <SwitchRow
                    label="Proxies only"
                    checked={d.proxyOnly}
                    onChange={(proxyOnly) => patch({ proxyOnly })}
                  />
                )}
              </FilterSection>
            )}
          </div>
        </Disclosure>
      </div>

      <footer className="collection-filters-dialog-footer">
        {draftMatchCount === 0 && (
          <p className="collection-filters-dialog-empty" role="status">
            {blocking
              ? `No cards match. Removing "${blocking}" would bring cards back.`
              : 'No cards match. Try removing a filter.'}
          </p>
        )}
        <div className="collection-filters-dialog-footer-start">
          <Button onClick={clearDraft} disabled={!draftHasAny}>
            Clear
          </Button>
          {canSaveAsBinder && (
            <Button
              variant="link"
              onClick={saveAsBinder}
              className="collection-filters-dialog-save-as-binder"
            >
              Save as a binder…
            </Button>
          )}
        </div>
        <ShowResultsButton count={draftMatchCount} onClick={apply} />
      </footer>
    </Modal>
  );
}

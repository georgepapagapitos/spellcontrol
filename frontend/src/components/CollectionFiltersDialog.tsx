import { ListFilter, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  BorderColor,
  ChipExpression,
  Condition,
  Finish,
  Format,
  Layout,
  MaterializedBinder,
  Treatment,
} from '../types';
import type { SetMap } from '../lib/api';
import { Modal } from './Modal';
import { SetFilterPicker } from './SetFilterPicker';
import { ColorPip } from './shared/ManaSymbol';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { TypeLineExpressionBuilder } from './TypeLineExpressionBuilder';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

/**
 * Pair of min/max number inputs. Mirrors the pattern used in BinderEditor
 * (not exported from there, so we keep a local copy).
 */
function NumberRangeInput({
  min,
  max,
  step,
  onMinChange,
  onMaxChange,
}: {
  min: number | undefined;
  max: number | undefined;
  step: number;
  onMinChange: (v: number | undefined) => void;
  onMaxChange: (v: number | undefined) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number"
        value={min ?? ''}
        step={step}
        min={0}
        placeholder="min"
        onChange={(e) =>
          onMinChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
        }
        style={{ width: 90 }}
      />
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
      <input
        type="number"
        value={max ?? ''}
        step={step}
        min={0}
        placeholder="max"
        onChange={(e) =>
          onMaxChange(e.target.value === '' ? undefined : parseFloat(e.target.value))
        }
        style={{ width: 90 }}
      />
    </div>
  );
}

// Closed vocabularies for the enum chip rows. Kept local — mirroring
// COLOR_FILTERS/RARITIES in the consuming pages — so this dialog isn't
// load-coupled to the binder rule editor that defines the same lists.
const FORMATS: Format[] = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'commander',
  'pauper',
];
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'split', label: 'Split' },
  { value: 'flip', label: 'Flip' },
  { value: 'transform', label: 'Transform' },
  { value: 'modal_dfc', label: 'Modal DFC' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'meld', label: 'Meld' },
  { value: 'leveler', label: 'Leveler' },
  { value: 'saga', label: 'Saga' },
  { value: 'planar', label: 'Planar' },
  { value: 'scheme', label: 'Scheme' },
  { value: 'vanguard', label: 'Vanguard' },
  { value: 'token', label: 'Token' },
  { value: 'double_faced_token', label: 'DFC token' },
  { value: 'emblem', label: 'Emblem' },
  { value: 'augment', label: 'Augment' },
  { value: 'host', label: 'Host' },
  { value: 'class', label: 'Class' },
];
const TREATMENTS: { value: Treatment; label: string }[] = [
  { value: 'fullart', label: 'Full art' },
  { value: 'extendedart', label: 'Extended art' },
  { value: 'showcase', label: 'Showcase' },
  { value: 'etched', label: 'Etched' },
  { value: 'inverted', label: 'Inverted' },
];
const BORDERS: { value: BorderColor; label: string }[] = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'borderless', label: 'Borderless' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
];
const FINISHES: { value: Finish; label: string }[] = [
  { value: 'nonfoil', label: 'Normal' },
  { value: 'foil', label: 'Foil' },
  { value: 'etched', label: 'Etched' },
];
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
  colorOptions: Array<{ key: string; label: string }>;

  rarityExpr: ChipExpression;
  setRarityExpr: (next: ChipExpression) => void;
  rarities: readonly string[];

  /**
   * Free-text oracle (rules) text search. Substring match, IS / IS NOT
   * per chip, AND/OR between chips — so "draw a card" AND "{T}" composes.
   */
  oracleExpr: ChipExpression;
  setOracleExpr: (next: ChipExpression) => void;

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
   * Binder section is collection-page-only. The deck-editor card search
   * doesn't have a binder concept, so it omits all three of these props
   * and the Binder section disappears entirely.
   */
  binderExpr?: ChipExpression;
  setBinderExpr?: (next: ChipExpression) => void;
  binders?: MaterializedBinder[];
  /** Force-hide binder section even when state is wired (binder-scoped views). */
  hideBinderFilter?: boolean;

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
   * "Group printings" toggle is collection-page-only — the deck editor
   * doesn't render rows per printing, so the option is meaningless and
   * the section just disappears when these are absent.
   */
  groupPrintings?: boolean;
  setGroupPrintings?: (next: boolean) => void;

  activeCount: number;
}

/**
 * Centered modal dialog that hosts every collection filter — type line,
 * color, rarity, binder, set, plus the group-printings option. Triggered
 * by the filter icon in the search pill; renders into a portal so it
 * overlays the whole app (backdrop + scroll lock).
 *
 * Edits stay local until **Apply** — picking chips, flipping joiners,
 * toggling colors etc. all mutate draft state inside the dialog. The
 * committed filters only change when the user explicitly applies.
 * **Clear** wipes the draft but leaves the dialog open. The close × /
 * backdrop click / Escape all dismiss without committing.
 *
 * Why deferred application: live-applying every keystroke caused the
 * card list to thrash and re-sort behind the dialog, which was both
 * distracting and slow on large collections.
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
        {hasActive && (
          <span className="collection-filters-badge" aria-hidden>
            {props.activeCount}
          </span>
        )}
      </button>
      {open &&
        createPortal(<DialogBody {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/**
 * The mounted-while-open body. Splitting this out lets `useState`
 * initializers seed the draft from current props on each open — no
 * effect-driven sync needed, no stale draft after close+reopen.
 */
function DialogBody({
  supertypeExpr,
  setSupertypeExpr,
  typesExpr,
  setTypesExpr,
  subtypeExpr,
  setSubtypeExpr,
  subtypeSuggestions,
  colorFilter,
  setColorFilter,
  colorOptions,
  rarityExpr,
  setRarityExpr,
  rarities,
  oracleExpr,
  setOracleExpr,
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
  binderExpr,
  setBinderExpr,
  binders,
  hideBinderFilter,
  setFilter,
  setSetFilter,
  setMap,
  priceMin,
  setPriceMin,
  priceMax,
  setPriceMax,
  cmcMin,
  setCmcMin,
  cmcMax,
  setCmcMax,
  groupPrintings,
  setGroupPrintings,
  onClose,
}: Props & { onClose: () => void }) {
  // Draft state — seeded once from props on mount; this component is
  // remounted on every dialog open, so the snapshot stays fresh.
  const [draftSuper, setDraftSuper] = useState<ChipExpression>(supertypeExpr);
  const [draftTypes, setDraftTypes] = useState<ChipExpression>(typesExpr);
  const [draftSubtype, setDraftSubtype] = useState<ChipExpression>(subtypeExpr);
  const [draftColor, setDraftColor] = useState<Set<string>>(() => new Set(colorFilter));
  const [draftRarity, setDraftRarity] = useState<ChipExpression>(rarityExpr);
  const [draftOracle, setDraftOracle] = useState<ChipExpression>(oracleExpr);
  const [draftLegality, setDraftLegality] = useState<ChipExpression>(legalityExpr);
  const [draftLayout, setDraftLayout] = useState<ChipExpression>(layoutExpr);
  const [draftTreatment, setDraftTreatment] = useState<ChipExpression>(treatmentExpr);
  const [draftBorder, setDraftBorder] = useState<ChipExpression>(borderExpr);
  const [draftFinish, setDraftFinish] = useState<ChipExpression>(finishExpr ?? EMPTY_EXPR);
  const [draftCondition, setDraftCondition] = useState<ChipExpression>(conditionExpr ?? EMPTY_EXPR);
  // Binder + groupPrintings are optional surfaces (collection-page only).
  // When the parent doesn't wire them up, the draft stays at its harmless
  // default and the section just doesn't render.
  const [draftBinder, setDraftBinder] = useState<ChipExpression>(binderExpr ?? EMPTY_EXPR);
  const [draftSet, setDraftSet] = useState<Set<string>>(() => new Set(setFilter));
  const [draftPriceMin, setDraftPriceMin] = useState<number | undefined>(priceMin);
  const [draftPriceMax, setDraftPriceMax] = useState<number | undefined>(priceMax);
  const [draftCmcMin, setDraftCmcMin] = useState<number | undefined>(cmcMin);
  const [draftCmcMax, setDraftCmcMax] = useState<number | undefined>(cmcMax);
  const [draftGroup, setDraftGroup] = useState<boolean>(groupPrintings ?? true);

  const showBinder = binderExpr !== undefined && !hideBinderFilter;
  const showOptions = groupPrintings !== undefined;
  const showFinish = finishExpr !== undefined;
  const showCondition = conditionExpr !== undefined;
  const showPrice = setPriceMin !== undefined || setPriceMax !== undefined;
  const showCmc = setCmcMin !== undefined || setCmcMax !== undefined;

  const draftHasAny =
    draftSuper.chips.length > 0 ||
    draftTypes.chips.length > 0 ||
    draftSubtype.chips.length > 0 ||
    draftColor.size > 0 ||
    draftRarity.chips.length > 0 ||
    draftOracle.chips.length > 0 ||
    draftLegality.chips.length > 0 ||
    draftLayout.chips.length > 0 ||
    draftTreatment.chips.length > 0 ||
    draftBorder.chips.length > 0 ||
    (showFinish && draftFinish.chips.length > 0) ||
    (showCondition && draftCondition.chips.length > 0) ||
    (showBinder && draftBinder.chips.length > 0) ||
    draftSet.size > 0 ||
    (showPrice && (draftPriceMin !== undefined || draftPriceMax !== undefined)) ||
    (showCmc && (draftCmcMin !== undefined || draftCmcMax !== undefined)) ||
    (showOptions && !draftGroup);

  const toggleDraftColor = (c: string) => {
    setDraftColor((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const apply = () => {
    setSupertypeExpr(draftSuper);
    setTypesExpr(draftTypes);
    setSubtypeExpr(draftSubtype);
    setColorFilter(draftColor);
    setRarityExpr(draftRarity);
    setOracleExpr(draftOracle);
    setLegalityExpr(draftLegality);
    setLayoutExpr(draftLayout);
    setTreatmentExpr(draftTreatment);
    setBorderExpr(draftBorder);
    if (showFinish) setFinishExpr?.(draftFinish);
    if (showCondition) setConditionExpr?.(draftCondition);
    if (showBinder) setBinderExpr?.(draftBinder);
    setSetFilter(draftSet);
    if (showPrice) {
      setPriceMin?.(draftPriceMin);
      setPriceMax?.(draftPriceMax);
    }
    if (showCmc) {
      setCmcMin?.(draftCmcMin);
      setCmcMax?.(draftCmcMax);
    }
    if (showOptions) setGroupPrintings?.(draftGroup);
    onClose();
  };

  const clearDraft = () => {
    setDraftSuper(EMPTY_EXPR);
    setDraftTypes(EMPTY_EXPR);
    setDraftSubtype(EMPTY_EXPR);
    setDraftColor(new Set());
    setDraftRarity(EMPTY_EXPR);
    setDraftOracle(EMPTY_EXPR);
    setDraftLegality(EMPTY_EXPR);
    setDraftLayout(EMPTY_EXPR);
    setDraftTreatment(EMPTY_EXPR);
    setDraftBorder(EMPTY_EXPR);
    setDraftFinish(EMPTY_EXPR);
    setDraftCondition(EMPTY_EXPR);
    setDraftBinder(EMPTY_EXPR);
    setDraftSet(new Set());
    setDraftPriceMin(undefined);
    setDraftPriceMax(undefined);
    setDraftCmcMin(undefined);
    setDraftCmcMax(undefined);
    setDraftGroup(true);
  };

  return (
    // The shared Modal supplies the backdrop, entrance/exit motion, focus
    // trap, Escape handling, and body scroll lock — this component only
    // styles the panel (UX-201 retired the bespoke root/backdrop/pop).
    <Modal onClose={onClose} label="Collection filters" className="collection-filters-dialog">
      <header className="collection-filters-dialog-header">
        <span className="collection-filters-dialog-title">Filters</span>
        <button
          type="button"
          className="collection-filters-dialog-close"
          onClick={onClose}
          aria-label="Close filters without applying"
          title="Close without applying"
        >
          <X width={20} height={20} strokeWidth={1.8} aria-hidden />
        </button>
      </header>

      <div className="collection-filters-dialog-body">
        {/* Type line — one shared input that auto-classifies each
              token into Supertypes / Type / Subtype, then displays
              classified chips in their respective row. Each row's
              chips are its own ChipExpression so AND/OR composes
              naturally per category. */}
        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Type line</div>
          <TypeLineExpressionBuilder
            supertypeExpr={draftSuper}
            setSupertypeExpr={setDraftSuper}
            typesExpr={draftTypes}
            setTypesExpr={setDraftTypes}
            subtypeExpr={draftSubtype}
            setSubtypeExpr={setDraftSubtype}
            subtypeSuggestions={subtypeSuggestions}
          />
        </section>

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Color</div>
          <div className="color-filter-row" role="group" aria-label="Filter by color">
            {colorOptions.map((c) => {
              const active = draftColor.has(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`color-filter-btn${active ? ' is-active' : ''}`}
                  onClick={() => toggleDraftColor(c.key)}
                  aria-label={c.label}
                  aria-pressed={active}
                  title={c.label}
                >
                  <ColorPip color={c.key} pip="lg" />
                </button>
              );
            })}
          </div>
        </section>

        {/* Single-valued fields (a card has one rarity, lives in one
              binder). The AND/OR joiner pills still render for visual
              consistency with the type-line rows, but flipping to AND
              between two values is unsatisfiable — the evaluator just
              returns no matches, which is technically correct.
              Defaults to OR for both. */}
        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Rarity</div>
          <ChipExpressionBuilder
            value={draftRarity}
            onChange={setDraftRarity}
            options={rarities.map((r) => ({
              value: r,
              label: r.charAt(0).toUpperCase() + r.slice(1),
            }))}
            defaultJoiner="OR"
            lockJoiner="OR"
            placeholder="Add rarity…"
          />
        </section>

        {/* Free-text oracle search — substring against the rules text.
              Defaults to OR so "draw" / "destroy" reads as either; flip a
              joiner to AND for "draw a card" AND "{T}". */}
        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Oracle text</div>
          <ChipExpressionBuilder
            value={draftOracle}
            onChange={setDraftOracle}
            suggestions={[]}
            defaultJoiner="OR"
            placeholder="e.g. flying, draw a card…"
          />
        </section>

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Format</div>
          <ChipExpressionBuilder
            value={draftLegality}
            onChange={setDraftLegality}
            options={FORMATS.map((f) => ({
              value: f,
              label: f.charAt(0).toUpperCase() + f.slice(1),
            }))}
            defaultJoiner="OR"
            placeholder="Add format…"
          />
        </section>

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Layout</div>
          <ChipExpressionBuilder
            value={draftLayout}
            onChange={setDraftLayout}
            options={LAYOUTS}
            defaultJoiner="OR"
            lockJoiner="OR"
            placeholder="Add layout…"
          />
        </section>

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Treatment</div>
          <ChipExpressionBuilder
            value={draftTreatment}
            onChange={setDraftTreatment}
            options={TREATMENTS}
            defaultJoiner="OR"
            placeholder="Add treatment…"
          />
        </section>

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Border</div>
          <ChipExpressionBuilder
            value={draftBorder}
            onChange={setDraftBorder}
            options={BORDERS}
            defaultJoiner="OR"
            lockJoiner="OR"
            placeholder="Add border…"
          />
        </section>

        {showFinish && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Finish</div>
            <ChipExpressionBuilder
              value={draftFinish}
              onChange={setDraftFinish}
              options={FINISHES}
              defaultJoiner="OR"
              lockJoiner="OR"
              placeholder="Add finish…"
            />
          </section>
        )}

        {showCondition && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Condition</div>
            <ChipExpressionBuilder
              value={draftCondition}
              onChange={setDraftCondition}
              options={CONDITIONS}
              defaultJoiner="OR"
              lockJoiner="OR"
              placeholder="Add condition…"
            />
          </section>
        )}

        {showBinder && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Binder</div>
            <ChipExpressionBuilder
              value={draftBinder}
              onChange={setDraftBinder}
              options={[
                ...(binders ?? []).map((b) => ({ value: b.def.name, label: b.def.name })),
                { value: '__uncategorized', label: 'Uncategorized' },
              ]}
              defaultJoiner="OR"
              lockJoiner="OR"
              placeholder="Add binder…"
            />
          </section>
        )}

        {showPrice && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Price</div>
            <NumberRangeInput
              min={draftPriceMin}
              max={draftPriceMax}
              step={0.01}
              onMinChange={setDraftPriceMin}
              onMaxChange={setDraftPriceMax}
            />
          </section>
        )}

        {showCmc && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Mana value</div>
            <NumberRangeInput
              min={draftCmcMin}
              max={draftCmcMax}
              step={1}
              onMinChange={setDraftCmcMin}
              onMaxChange={setDraftCmcMax}
            />
          </section>
        )}

        <section className="collection-filters-section">
          <div className="collection-filters-section-label">Set</div>
          <SetFilterPicker setMap={setMap} value={draftSet} onChange={setDraftSet} />
        </section>

        {showOptions && (
          <section className="collection-filters-section">
            <div className="collection-filters-section-label">Options</div>
            <label className="filter-popover-row">
              <input
                type="checkbox"
                checked={draftGroup}
                onChange={(e) => setDraftGroup(e.target.checked)}
              />
              <span className="filter-popover-label">Group printings</span>
            </label>
          </section>
        )}
      </div>

      <footer className="collection-filters-dialog-footer">
        <button
          type="button"
          className="collection-filters-dialog-clear"
          onClick={clearDraft}
          disabled={!draftHasAny}
        >
          Clear
        </button>
        <button type="button" className="collection-filters-dialog-done" onClick={apply}>
          Apply
        </button>
      </footer>
    </Modal>
  );
}

import { useState, useEffect, useId, useMemo, useRef } from 'react';
import { currencySymbol } from '../lib/currency';
import { isFilterEmpty } from '../lib/rules';
import { countBinderMatches } from '../lib/binder-counts';
import { cardTagLabel } from '../lib/card-tags';
import { STARTER_TEMPLATES, type StarterTemplate } from '../lib/binder-templates';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { InfoTip } from './InfoTip';
import { BinderRow as RuleRow, FilterFieldEditor, NumberRangeInput } from './FilterFieldEditor';
import { RuleFieldContext } from './RuleFieldContext';
import { RuleFieldPicker } from './RuleFieldPicker';
import { filterFieldSpec, setFilterFields, type FilterFieldId } from '../lib/filter-fields';
import type {
  BinderFilter,
  BinderFilterGroup,
  ChipExpression,
  ColorChoice,
  EnrichedCard,
  Rarity,
} from '../types';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };
const COLORS: { key: ColorChoice; label: string }[] = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'M', label: 'Multicolor' },
  { key: 'C', label: 'Colorless' },
];
const DEFAULT_EDHREC_TOP_N = 100;

// ── Progressive-disclosure field split ────────────────────────────────────
// ABOVE the fold (always visible, most-reached-for fields):
//   Type line, Color identity, Rarity, CMC (mana value), Price
// BELOW the fold (collapsed behind "More rules" expander):
//   Name contains, Mana cost, Commander, Proxy, Sets, Finishes, Layout,
//   Treatment, Border, EDHREC popularity, Legalities, Oracle text, Scryfall
//   query
//
// Auto-open rule: if any collapsed field carries a value, the expander must
// start open so the user can see their active rules when editing.

/* ─────────────────────────── filter-group UI ─────────────────────────── */

/**
 * Renders the OR-list of filter groups. Each group is a `<fieldset>` whose
 * `<legend>` carries the optional name (acting as a heading for assistive tech)
 * and a remove button. An "OR" divider sits between groups (decorative;
 * meaning is in the fieldset semantics). A single "+ Add OR group" button
 * follows the list.
 */
// Exported for reuse by the dynamic-list rule editor (ListRuleEditor) — the
// group list is pure rule-editing UI with no binder-specific chrome.
export function FilterGroupList({
  groups,
  cards,
  keepPrintingsTogether,
  ownedSets,
  typeSuggestions,
  oracleSuggestions,
  autofocusIdx,
  clearAutofocus,
  onPatchFilter,
  onSetName,
  onAdd,
  onDuplicate,
  onRemove,
  isNewBinder,
}: {
  groups: BinderFilterGroup[];
  cards: EnrichedCard[];
  keepPrintingsTogether: boolean;
  ownedSets: { code: string; label: string }[];
  typeSuggestions: string[];
  oracleSuggestions: string[];
  autofocusIdx: number | null;
  clearAutofocus: () => void;
  onPatchFilter: (idx: number, p: Partial<BinderFilter>) => void;
  onSetName: (idx: number, name: string) => void;
  onAdd: () => void;
  onDuplicate: (idx: number) => void;
  onRemove: (idx: number) => void;
  isNewBinder: boolean;
}) {
  // Per-group counts are always raw rule matches; the total expands to
  // pulled-in printings when "keep all printings together" is on. See
  // countBinderMatches.
  const { perGroup, total } = useMemo(
    () => countBinderMatches(cards, groups, keepPrintingsTogether),
    [groups, cards, keepPrintingsTogether]
  );

  return (
    <div className="filter-group-list">
      {groups.map((g, i) => (
        <div key={i}>
          <FilterGroupCard
            group={g}
            index={i}
            total={groups.length}
            matchCount={perGroup[i] ?? 0}
            ownedSets={ownedSets}
            typeSuggestions={typeSuggestions}
            oracleSuggestions={oracleSuggestions}
            autofocus={autofocusIdx === i}
            onAutofocusHandled={clearAutofocus}
            onPatchFilter={(p) => onPatchFilter(i, p)}
            onSetName={(n) => onSetName(i, n)}
            onDuplicate={() => onDuplicate(i)}
            onRemove={() => onRemove(i)}
            showTemplates={isNewBinder && i === 0 && groups.length === 1}
          />
          {i < groups.length - 1 && (
            <div className="filter-group-or" aria-hidden="true">
              <span>OR</span>
            </div>
          )}
        </div>
      ))}

      <div className="filter-group-footer">
        <button
          type="button"
          className="btn btn-add-group"
          onClick={onAdd}
          title="Add a whole alternative rule that OR's against everything above. Use this when you want entirely different combinations of fields — e.g. (Mythic creatures) OR (Rare instants). For OR within a single field, use the AND/OR pill between chips."
        >
          + Add OR rule
        </button>
        <span className="filter-group-help" aria-hidden>
          Use OR rules for whole alternative patterns. Within a single field, the{' '}
          <strong>AND</strong>/<strong>OR</strong> pill between chips already handles per-field OR.
        </span>
        {(groups.length > 1 || keepPrintingsTogether) && (
          <span className="filter-group-total" aria-live="polite">
            Matches <strong>{total.toLocaleString()}</strong> {total === 1 ? 'card' : 'cards'} total
          </span>
        )}
        {keepPrintingsTogether && (
          <span className="filter-group-help" aria-hidden>
            Per-rule counts are rule matches; the total also counts every printing pulled in by
            “keep all printings together”.
          </span>
        )}
      </div>
    </div>
  );
}

function FilterGroupCard({
  group,
  index,
  total,
  matchCount,
  ownedSets,
  typeSuggestions,
  oracleSuggestions,
  autofocus,
  onAutofocusHandled,
  onPatchFilter,
  onSetName,
  onDuplicate,
  onRemove,
  showTemplates,
}: {
  group: BinderFilterGroup;
  index: number;
  total: number;
  matchCount: number;
  ownedSets: { code: string; label: string }[];
  typeSuggestions: string[];
  oracleSuggestions: string[];
  autofocus: boolean;
  onAutofocusHandled: () => void;
  onPatchFilter: (p: Partial<BinderFilter>) => void;
  onSetName: (n: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  showTemplates: boolean;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autofocus && nameRef.current) {
      nameRef.current.focus();
      onAutofocusHandled();
    }
  }, [autofocus, onAutofocusHandled]);

  // Bumped when the "A set binder" template is tapped → FilterGroupFields opens
  // its "More rules" section and scrolls the Sets picker into view.
  const [revealSetsSignal, setRevealSetsSignal] = useState(0);

  const summary = autoSummary(group.filter);
  const fallback = `Rule group ${index + 1}`;
  const displayLabel = group.name?.trim() || summary || fallback;

  // Templates are only visible when there is no filter content yet.
  const hasContent = !isFilterEmpty(group.filter);
  const shouldShowTemplates = showTemplates && !hasContent;

  return (
    <fieldset className="filter-group">
      <legend className="filter-group-legend">
        <input
          ref={nameRef}
          className="filter-group-name"
          value={group.name ?? ''}
          onChange={(e) => onSetName(e.target.value)}
          placeholder={summary || fallback}
          aria-label={`Rule group ${index + 1} name`}
        />
        {/* `aria-live` because this is the feedback loop of the whole editor:
            you change a rule to watch this number move. The aggregate total
            below already announced; the per-group count — the one that responds
            to the field you are actually touching — did not. */}
        <span
          className="filter-group-count"
          aria-live="polite"
          aria-label={`Rule group ${index + 1} matches ${matchCount} ${matchCount === 1 ? 'card' : 'cards'}`}
        >
          {matchCount.toLocaleString()} {matchCount === 1 ? 'card' : 'cards'}
        </span>
        <span className="filter-group-actions">
          <button
            type="button"
            className="tab-action"
            onClick={onDuplicate}
            title="Duplicate this rule group"
            aria-label={`Duplicate rule group: ${displayLabel}`}
          >
            ⎘
          </button>
          <button
            type="button"
            className="tab-action"
            onClick={onRemove}
            disabled={total <= 1}
            title={total <= 1 ? 'A binder needs at least one rule group' : 'Remove this rule group'}
            aria-label={`Remove rule group: ${displayLabel}`}
          >
            ×
          </button>
        </span>
      </legend>
      {shouldShowTemplates && (
        <StarterTemplates
          onApply={(tpl) => {
            if (tpl.filter) onPatchFilter(tpl.filter);
            // Pre-fill the group name with the template label if the user
            // hasn't typed anything yet.
            if (!group.name?.trim()) onSetName(tpl.label);
            // Action-only template: reveal the Sets picker rather than applying
            // an (empty, match-everything) constraint.
            if (tpl.revealSets) setRevealSetsSignal((n) => n + 1);
          }}
        />
      )}
      <FilterGroupFields
        filter={group.filter}
        onPatch={onPatchFilter}
        ownedSets={ownedSets}
        typeSuggestions={typeSuggestions}
        oracleSuggestions={oracleSuggestions}
        revealSetsSignal={revealSetsSignal}
      />
    </fieldset>
  );
}

/**
 * One-tap starter templates. Shown only on a new binder's first rule group
 * when that group has no rule content. Tapping a template pre-fills the form
 * fields (the user can still edit everything); the templates disappear once
 * any real rule content exists.
 */
function StarterTemplates({ onApply }: { onApply: (tpl: StarterTemplate) => void }) {
  return (
    <div className="starter-templates" aria-label="Quick-start templates">
      <span className="starter-templates-label">Start with a template:</span>
      <div className="starter-templates-list">
        {STARTER_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="starter-template-btn"
            onClick={() => onApply(tpl)}
          >
            <span className="starter-template-label">{tpl.label}</span>
            {/* Description is visible (not a hover title) so it works on touch. */}
            <span className="starter-template-desc">{tpl.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The rule-rows that make up a single filter group, split into above-fold
 * (always visible) and below-fold (collapsed behind "More rules" expander).
 *
 * Above the fold — common rules reached for most binders:
 *   Type line, Color identity, Rarity, Mana value (CMC), Price
 *
 * Below the fold (collapsed by default):
 *   Name contains, Mana cost, Commander, Proxy, Sets, Finishes, Layout,
 *   Treatment, Border, EDHREC popularity, Legalities, Oracle text
 *
 * Auto-open: if any below-fold field has a value (editing an existing binder),
 * the expander starts open so active rules are never hidden.
 */
function FilterGroupFields({
  filter,
  onPatch,
  ownedSets,
  typeSuggestions,
  oracleSuggestions,
  revealSetsSignal = 0,
}: {
  filter: BinderFilter;
  onPatch: (p: Partial<BinderFilter>) => void;
  ownedSets: { code: string; label: string }[];
  typeSuggestions: string[];
  oracleSuggestions: string[];
  /** Bumped by the "A set binder" template — open this section + reveal Sets. */
  revealSetsSignal?: number;
}) {
  const patch = onPatch;
  // Radios group by shared `name` — several rule editors can be on screen.
  const commanderEligibleGroup = useId();
  const proxyGroup = useId();
  const edhrecEnabled = filter.edhrecRankMax !== undefined;
  const setsRowRef = useRef<HTMLDivElement>(null);

  // Fields the user added that don't hold a value yet. A field with a value is
  // visible on its own account (`setFilterFields`), so this only has to carry
  // the gap between "I picked Rarity" and "I typed a rarity into it".
  const [added, setAdded] = useState<Set<FilterFieldId>>(() => new Set());
  const withValues = setFilterFields(filter);
  const visibleFields = useMemo(() => {
    const next = new Set(withValues);
    for (const id of added) next.add(id);
    return next;
  }, [withValues, added]);

  const visibility = useMemo(
    () => ({
      isVisible: (id: FilterFieldId) => visibleFields.has(id),
      clearField: (id: FilterFieldId) => {
        const spec = filterFieldSpec(id);
        if (spec) patch(spec.clear());
        setAdded((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
    }),
    [visibleFields, patch]
  );

  // "A set binder" template: reveal + scroll to the Sets row. Render-phase
  // rising-edge compare, so the lint-discouraged setState-in-effect isn't
  // needed. Signal 0 = initial mount → no reveal, so editing an existing
  // binder is unaffected.
  const [prevRevealSignal, setPrevRevealSignal] = useState(revealSetsSignal);
  if (revealSetsSignal !== prevRevealSignal) {
    setPrevRevealSignal(revealSetsSignal);
    setAdded((prev) => new Set(prev).add('setCodes'));
  }
  useEffect(() => {
    if (revealSetsSignal === 0) return;
    const raf = requestAnimationFrame(() => {
      setsRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [revealSetsSignal]);

  return (
    <RuleFieldContext.Provider value={visibility}>
      {/* ── Above the fold: Type line, Color identity, Rarity, CMC, Price ── */}

      {/* Type chips */}
      <RuleRow
        fieldId="typeChips"
        label={
          <>
            Type line{' '}
            <InfoTip
              label="type line filter"
              text="Substring match against the WHOLE type line, so 'Legendary Creature' works. Each chip toggles between IS and IS NOT: IS Creature + IS NOT Legendary excludes legendary creatures. For one part of the line on its own, use Supertype, Card type or Subtype."
            />
          </>
        }
      >
        <ChipExpressionBuilder
          value={filter.typeChips ?? EMPTY_EXPR}
          onChange={(next) => patch({ typeChips: next })}
          suggestions={typeSuggestions}
          defaultJoiner="OR"
          placeholder="e.g. creature, angel, legendary"
        />
      </RuleRow>

      {/* Colors */}
      <RuleRow fieldId="colors" label="Color identity">
        <ChipExpressionBuilder
          options={COLORS.map((c) => ({ value: c.key, label: c.label }))}
          value={filter.colors ?? EMPTY_EXPR}
          onChange={(next) => patch({ colors: next })}
          defaultJoiner="OR"
          placeholder="Add color..."
        />
      </RuleRow>

      {/* Rarity */}
      <RuleRow fieldId="rarities" label="Rarity">
        <ChipExpressionBuilder
          options={RARITIES.map((r) => ({ value: r, label: r }))}
          value={filter.rarities ?? EMPTY_EXPR}
          onChange={(next) => patch({ rarities: next })}
          defaultJoiner="OR"
          placeholder="Add rarity..."
        />
      </RuleRow>

      {/* Mana value */}
      <RuleRow fieldId="cmc" label="Mana value">
        <NumberRangeInput
          min={filter.cmcMin}
          max={filter.cmcMax}
          step={1}
          onMinChange={(v) => patch({ cmcMin: v })}
          onMaxChange={(v) => patch({ cmcMax: v })}
        />
      </RuleRow>

      {/* Price */}
      <RuleRow fieldId="price" label="Price ($)">
        <NumberRangeInput
          min={filter.priceMin}
          max={filter.priceMax}
          step={0.25}
          onMinChange={(v) => patch({ priceMin: v })}
          onMaxChange={(v) => patch({ priceMax: v })}
        />
      </RuleRow>

      {/* Name contains */}
      <RuleRow fieldId="nameContains" label="Name contains">
        <input
          type="text"
          value={filter.nameContains || ''}
          onChange={(e) => patch({ nameContains: e.target.value })}
          placeholder="e.g. dragon, sword..."
        />
      </RuleRow>

      {/* Mana cost */}
      <RuleRow
        fieldId="manaCost"
        label={
          <>
            Mana cost{' '}
            <InfoTip
              label="mana cost filter"
              text="Exact mana cost match. Use Scryfall syntax with curly braces, e.g. {2}{G}{W} or {1}{R/W}. Leave blank to ignore."
            />
          </>
        }
      >
        <input
          type="text"
          value={filter.manaCost || ''}
          onChange={(e) => patch({ manaCost: e.target.value })}
          placeholder="{2}{G}{W}"
        />
      </RuleRow>

      {/* Commander eligibility */}
      <RuleRow
        fieldId="commanderEligible"
        label={
          <>
            Commander{' '}
            <InfoTip
              label="commander eligibility"
              text="Matches legal commanders: legendary creatures and cards that say 'can be your commander' (e.g. planeswalker-commanders), legal in the Commander format."
            />
          </>
        }
      >
        <fieldset className="rule-segmented" aria-label="Commander eligibility">
          {(
            [
              { v: undefined, label: 'Any' },
              { v: true, label: 'Is' },
              { v: false, label: 'Is not' },
            ] as const
          ).map(({ v, label }) => (
            <label
              key={label}
              className={`rule-segmented-pill${filter.commanderEligible === v ? ' active' : ''}`}
            >
              <input
                type="radio"
                name={commanderEligibleGroup}
                checked={filter.commanderEligible === v}
                onChange={() => patch({ commanderEligible: v })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </RuleRow>

      {/* Proxy */}
      <RuleRow
        fieldId="proxy"
        label={
          <>
            Proxy{' '}
            <InfoTip
              label="proxy filter"
              text="Matches cards flagged as proxies — stand-in copies with no market value. Use this to keep proxies out of binders meant for real cards, or to route them into a dedicated proxy binder."
            />
          </>
        }
      >
        <fieldset className="rule-segmented" aria-label="Proxy">
          {(
            [
              { v: undefined, label: 'Any' },
              { v: true, label: 'Is' },
              { v: false, label: 'Is not' },
            ] as const
          ).map(({ v, label }) => (
            <label
              key={label}
              className={`rule-segmented-pill${filter.proxy === v ? ' active' : ''}`}
            >
              <input
                type="radio"
                name={proxyGroup}
                checked={filter.proxy === v}
                onChange={() => patch({ proxy: v })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </RuleRow>

      {/* Sets */}
      <RuleRow fieldId="setCodes" label="Sets" rowRef={setsRowRef}>
        <SetMultiSelect
          options={ownedSets}
          selected={filter.setCodes || []}
          onChange={(next) => patch({ setCodes: next })}
        />
      </RuleRow>

      {/* EDHREC */}
      <RuleRow
        fieldId="edhrecRankMax"
        label={
          <>
            EDHREC popularity{' '}
            <InfoTip
              label="EDHREC popularity"
              text="EDHREC tracks how often each card appears in EDH/Commander decks. Lower rank = more popular. Top 100 = roughly the most-played 100 cards across the format."
            />
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={edhrecEnabled}
              onChange={(e) =>
                patch({
                  edhrecRankMax: e.target.checked ? DEFAULT_EDHREC_TOP_N : undefined,
                })
              }
            />
            Top
          </label>
          <input
            type="number"
            value={filter.edhrecRankMax ?? ''}
            min={1}
            max={50000}
            step={50}
            disabled={!edhrecEnabled}
            placeholder={String(DEFAULT_EDHREC_TOP_N)}
            onChange={(e) =>
              patch({
                edhrecRankMax: e.target.value === '' ? undefined : parseInt(e.target.value),
              })
            }
            style={{ width: 90 }}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            most popular EDH cards
          </span>
        </div>
      </RuleRow>

      {/* Oracle · Legality · Layout · Treatment · Border · Finish
              Supertype · Type · Subtype — shared rows via FilterFieldEditor */}
      <FilterFieldEditor
        value={filter}
        onPatch={patch}
        subtypeSuggestions={typeSuggestions}
        oracleSuggestions={oracleSuggestions}
        showTypeRows
        showOracleTags
        showScryfallQuery
        showFinish
        variant="binder"
      />

      <div className="rule-add-row">
        <RuleFieldPicker
          inUse={visibleFields}
          onPick={(id) => setAdded((prev) => new Set(prev).add(id))}
        />
        {visibleFields.size === 0 && (
          <span className="rule-add-hint">
            No rules yet — this group matches every card left over from the binders above it.
          </span>
        )}
      </div>
    </RuleFieldContext.Provider>
  );
}

/**
 * Build a short human-readable summary of a filter for use as the group's
 * legend placeholder and aria-label fallback. Walks every filter field;
 * caps at 4 parts so the summary stays scannable. Returns '' for an empty
 * filter. Field order is roughly "most distinguishing first" so when the
 * cap kicks in you keep the parts a user is most likely to recognize.
 */
function autoSummary(f: BinderFilter): string {
  const parts: string[] = [];
  const chipNames = (expr: ChipExpression | undefined, max = 2) => {
    if (!expr || expr.chips.length === 0) return null;
    const is = expr.chips.filter((c) => !c.negate).map((c) => c.value);
    if (is.length === 0) return null;
    if (is.length <= max) return is.join(', ');
    return `${is.slice(0, max).join(', ')} +${is.length - max}`;
  };
  const push = (s: string | null | undefined) => {
    if (s) parts.push(s);
  };

  push(chipNames(f.rarities));
  push(chipNames(f.typeChips));
  push(chipNames(f.colors));
  push(chipNames(f.treatments));
  push(chipNames(f.finishes));
  push(chipNames(f.layouts));
  push(chipNames(f.borderColors));
  push(chipNames(f.legalities));
  push(chipNames(f.oracleChips));
  // Tags summarize with their friendly label (e.g. "mana-rock" → "Mana rock").
  {
    const tagIs = f.oracleTagChips?.chips
      .filter((c) => !c.negate)
      .map((c) => cardTagLabel(c.value));
    if (tagIs && tagIs.length > 0) {
      push(
        tagIs.length <= 2
          ? tagIs.join(', ')
          : `${tagIs.slice(0, 2).join(', ')} +${tagIs.length - 2}`
      );
    }
  }

  if (f.commanderEligible === true) parts.push('Commander');
  else if (f.commanderEligible === false) parts.push('Not commander');

  if (f.proxy === true) parts.push('Proxy');
  else if (f.proxy === false) parts.push('Not proxy');

  if (f.setCodes && f.setCodes.length > 0) {
    push(
      f.setCodes.length <= 2
        ? f.setCodes.join(', ')
        : `${f.setCodes.slice(0, 2).join(', ')} +${f.setCodes.length - 2}`
    );
  }

  // Price rules match against the display-currency price — label accordingly.
  const sym = currencySymbol();
  if (f.priceMin !== undefined && f.priceMax !== undefined)
    parts.push(`${sym}${f.priceMin}–${f.priceMax}`);
  else if (f.priceMin !== undefined) parts.push(`≥ ${sym}${f.priceMin}`);
  else if (f.priceMax !== undefined) parts.push(`≤ ${sym}${f.priceMax}`);

  if (f.cmcMin !== undefined && f.cmcMax !== undefined)
    parts.push(`Mana value ${f.cmcMin}–${f.cmcMax}`);
  else if (f.cmcMin !== undefined) parts.push(`Mana value ≥ ${f.cmcMin}`);
  else if (f.cmcMax !== undefined) parts.push(`Mana value ≤ ${f.cmcMax}`);

  if (f.edhrecRankMax !== undefined) parts.push(`EDH top ${f.edhrecRankMax}`);
  if (f.manaCost?.trim()) parts.push(f.manaCost.trim());
  if (f.nameContains?.trim()) parts.push(`"${f.nameContains.trim()}"`);
  if (f.scryfallQuery?.query.trim()) parts.push(`⌕ ${f.scryfallQuery.query.trim()}`);

  return parts.slice(0, 4).join(' · ');
}

/** Deep-clone the chip fields of a filter (so duplication doesn't share mutable refs). */
export function cloneChips(f: BinderFilter): Partial<BinderFilter> {
  const dup = (expr?: ChipExpression): ChipExpression | undefined =>
    expr ? { chips: expr.chips.map((c) => ({ ...c })), joiners: [...expr.joiners] } : undefined;
  return {
    legalities: dup(f.legalities),
    colors: dup(f.colors),
    rarities: dup(f.rarities),
    typeChips: dup(f.typeChips),
    typeTokenChips: dup(f.typeTokenChips),
    supertypeChips: dup(f.supertypeChips),
    subtypeChips: dup(f.subtypeChips),
    oracleChips: dup(f.oracleChips),
    oracleTagChips: dup(f.oracleTagChips),
    finishes: dup(f.finishes),
    layouts: dup(f.layouts),
    treatments: dup(f.treatments),
    borderColors: dup(f.borderColors),
    setCodes: f.setCodes ? [...f.setCodes] : undefined,
    scryfallQuery: f.scryfallQuery
      ? { ...f.scryfallQuery, oracleIds: [...f.scryfallQuery.oracleIds] }
      : undefined,
  };
}

/* ─────────────────────────── small components ─────────────────────────── */

/** Multi-select dropdown for set codes. Selected sets render as removable chips. */
function SetMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { code: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedSet = new Set(selected.map((s) => s.toUpperCase()));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !q || o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [options, query]);

  const addCode = (code: string) => {
    if (!selectedSet.has(code)) onChange([...selected, code]);
  };

  return (
    <div className="chip-builder-wrap">
      {selected.map((code) => {
        const opt = options.find((o) => o.code.toUpperCase() === code.toUpperCase());
        return (
          <span key={code} className="chip-builder-chip is" title={opt?.label || code}>
            <span className="chip-builder-value">{code.toUpperCase()}</span>
            <button
              type="button"
              className="chip-builder-remove"
              aria-label="Remove"
              onClick={() =>
                onChange(selected.filter((s) => s.toUpperCase() !== code.toUpperCase()))
              }
            >
              ×
            </button>
          </span>
        );
      })}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={options.length === 0 ? 'no cards loaded' : 'add set...'}
          disabled={options.length === 0}
        />
        {open && filtered.length > 0 && (
          <div className="set-dropdown">
            {filtered.slice(0, 30).map((o) => (
              <button
                key={o.code}
                type="button"
                className={`set-dropdown-item ${selectedSet.has(o.code) ? 'selected' : ''}`}
                onClick={() => {
                  addCode(o.code);
                  setQuery('');
                }}
              >
                <span className="set-code">{o.code}</span>
                <span className="set-name">{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function validateRanges(f: BinderFilter): string | null {
  // NaN first, and before anything else. `parseFloat('')` / `parseInt('e')` in
  // the number inputs can put NaN on the filter, and EVERY comparison below is
  // `false` against NaN — so a NaN sailed through untouched, compiled into the
  // matcher as a live constraint nothing can fail, and silently read as "no
  // minimum". The live match count then disagreed with what actually saved,
  // because `cleanFilter` strips NaN on the way out but this gate didn't.
  const numeric: Array<[number | undefined, string]> = [
    [f.priceMin, 'Price minimum'],
    [f.priceMax, 'Price maximum'],
    [f.cmcMin, 'Mana value minimum'],
    [f.cmcMax, 'Mana value maximum'],
    [f.edhrecRankMax, 'EDHREC top N'],
  ];
  for (const [value, label] of numeric) {
    if (value !== undefined && Number.isNaN(value)) return `${label} isn't a number`;
  }

  if (f.priceMin !== undefined && f.priceMax !== undefined && f.priceMin > f.priceMax) {
    return "Price minimum can't exceed maximum";
  }
  if (f.cmcMin !== undefined && f.cmcMax !== undefined && f.cmcMin > f.cmcMax) {
    return "Mana value minimum can't exceed maximum";
  }
  // Both ends, not only the minimum. A lone negative MAX ("nothing over -5")
  // matches zero cards, which is exactly the mistake worth catching.
  if (f.priceMin !== undefined && f.priceMin < 0) return "Price can't be negative";
  if (f.priceMax !== undefined && f.priceMax < 0) return "Price can't be negative";
  if (f.cmcMin !== undefined && f.cmcMin < 0) return "Mana value can't be negative";
  if (f.cmcMax !== undefined && f.cmcMax < 0) return "Mana value can't be negative";
  if (f.edhrecRankMax !== undefined && f.edhrecRankMax < 1) {
    return 'EDHREC top N must be at least 1';
  }
  return null;
}

/**
 * First validation error across a whole OR-chain of groups, tagged with which
 * group it came from. Both editors call this now — the binder modal validated
 * its groups at save time while the dynamic-list sheet, mounting the identical
 * controls, validated nothing at all.
 */
export function validateGroups(groups: BinderFilterGroup[]): string | null {
  for (let i = 0; i < groups.length; i++) {
    const err = validateRanges(groups[i].filter);
    if (err) return groups.length > 1 ? `Rule group ${i + 1}: ${err}` : err;
  }
  return null;
}

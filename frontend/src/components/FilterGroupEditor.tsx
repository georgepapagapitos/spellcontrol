import { useState, useEffect, useId, useMemo, useRef } from 'react';
import { currencySymbol } from '../lib/currency';
import { countBinderMatches } from '../lib/binder-counts';
import { cardTagLabel } from '../lib/card-tags';
import { STARTER_TEMPLATES, type StarterTemplate } from '../lib/binder-templates';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { InfoTip } from './InfoTip';
import { FilterFieldEditor, NumberRangeInput } from './FilterFieldEditor';
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

/** True when the filter has at least one active rule field. */
function isFilterEmpty(f: BinderFilter): boolean {
  if (f.priceMin !== undefined || f.priceMax !== undefined) return false;
  if (f.cmcMin !== undefined || f.cmcMax !== undefined) return false;
  if (f.manaCost?.trim()) return false;
  if (f.nameContains?.trim()) return false;
  if (f.commanderEligible !== undefined) return false;
  if (f.proxy !== undefined) return false;
  if (f.edhrecRankMax !== undefined) return false;
  if (f.setCodes && f.setCodes.length > 0) return false;
  const chipFields = [
    f.legalities,
    f.colors,
    f.rarities,
    f.typeChips,
    f.typeTokenChips,
    f.supertypeChips,
    f.subtypeChips,
    f.oracleChips,
    f.oracleTagChips,
    f.finishes,
    f.layouts,
    f.treatments,
    f.borderColors,
  ] as const;
  for (const expr of chipFields) {
    if (expr && expr.chips.length > 0) return false;
  }
  return true;
}

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

/** Returns true when the filter has a value in any collapsed (below-fold) field. */
function hasCollapsedFieldValue(f: BinderFilter): boolean {
  if (f.nameContains?.trim()) return true;
  if (f.manaCost?.trim()) return true;
  if (f.commanderEligible !== undefined) return true;
  if (f.proxy !== undefined) return true;
  if (f.setCodes && f.setCodes.length > 0) return true;
  if (f.edhrecRankMax !== undefined) return true;
  if (f.finishes && f.finishes.chips.length > 0) return true;
  if (f.layouts && f.layouts.chips.length > 0) return true;
  if (f.treatments && f.treatments.chips.length > 0) return true;
  if (f.borderColors && f.borderColors.chips.length > 0) return true;
  if (f.legalities && f.legalities.chips.length > 0) return true;
  if (f.oracleChips && f.oracleChips.chips.length > 0) return true;
  if (f.oracleTagChips && f.oracleTagChips.chips.length > 0) return true;
  if (f.scryfallQuery) return true;
  if (f.typeTokenChips && f.typeTokenChips.chips.length > 0) return true;
  if (f.supertypeChips && f.supertypeChips.chips.length > 0) return true;
  if (f.subtypeChips && f.subtypeChips.chips.length > 0) return true;
  return false;
}
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
        <span className="filter-group-count" aria-label={`${matchCount} cards match`}>
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

  // Auto-open the expander when a collapsed field already has a value.
  const [moreOpen, setMoreOpen] = useState(() => hasCollapsedFieldValue(filter));

  // Auto-open only when a collapsed field GAINS a value (e.g. a template
  // pre-fills Sets) — the rising edge, not every render, so the user can
  // still collapse manually and rely on the ● badge for hidden active rules.
  // Canonical adjust-state-during-render pattern (prev-value compare).
  const collapsedHasValue = hasCollapsedFieldValue(filter);
  const [prevCollapsedHasValue, setPrevCollapsedHasValue] = useState(collapsedHasValue);
  if (collapsedHasValue !== prevCollapsedHasValue) {
    setPrevCollapsedHasValue(collapsedHasValue);
    if (collapsedHasValue && !moreOpen) setMoreOpen(true);
  }

  // "A set binder" template: open the section (render-phase rising-edge, same
  // pattern as collapsedHasValue above) so the lint-discouraged setState-in-
  // effect isn't needed. The DOM scroll stays in an effect (it needs the
  // committed layout). Signal 0 = initial mount → no auto-open/scroll, so
  // editing an existing binder is unaffected.
  const [prevRevealSignal, setPrevRevealSignal] = useState(revealSetsSignal);
  if (revealSetsSignal !== prevRevealSignal) {
    setPrevRevealSignal(revealSetsSignal);
    if (!moreOpen) setMoreOpen(true);
  }
  useEffect(() => {
    if (revealSetsSignal === 0) return;
    const raf = requestAnimationFrame(() => {
      setsRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [revealSetsSignal]);

  return (
    <>
      {/* ── Above the fold: Type line, Color identity, Rarity, CMC, Price ── */}

      {/* Type chips */}
      <div className="rule-row">
        <span className="rule-label">
          Type line{' '}
          <InfoTip
            label="type line filter"
            text="Substring match against the type line. Each chip can be toggled between IS and IS NOT. Example: IS Creature + IS NOT Legendary excludes legendary creatures."
          />
        </span>
        <ChipExpressionBuilder
          value={filter.typeChips ?? EMPTY_EXPR}
          onChange={(next) => patch({ typeChips: next })}
          suggestions={typeSuggestions}
          defaultJoiner="OR"
          placeholder="e.g. creature, angel, legendary"
        />
      </div>

      {/* Colors */}
      <div className="rule-row">
        <span className="rule-label">Color identity</span>
        <ChipExpressionBuilder
          options={COLORS.map((c) => ({ value: c.key, label: c.label }))}
          value={filter.colors ?? EMPTY_EXPR}
          onChange={(next) => patch({ colors: next })}
          defaultJoiner="OR"
          placeholder="Add color..."
        />
      </div>

      {/* Rarity */}
      <div className="rule-row">
        <span className="rule-label">Rarity</span>
        <ChipExpressionBuilder
          options={RARITIES.map((r) => ({ value: r, label: r }))}
          value={filter.rarities ?? EMPTY_EXPR}
          onChange={(next) => patch({ rarities: next })}
          defaultJoiner="OR"
          placeholder="Add rarity..."
        />
      </div>

      {/* Mana value */}
      <div className="rule-row">
        <span className="rule-label">Mana value</span>
        <NumberRangeInput
          min={filter.cmcMin}
          max={filter.cmcMax}
          step={1}
          onMinChange={(v) => patch({ cmcMin: v })}
          onMaxChange={(v) => patch({ cmcMax: v })}
        />
      </div>

      {/* Price */}
      <div className="rule-row">
        <span className="rule-label">Price ($)</span>
        <NumberRangeInput
          min={filter.priceMin}
          max={filter.priceMax}
          step={0.25}
          onMinChange={(v) => patch({ priceMin: v })}
          onMaxChange={(v) => patch({ priceMax: v })}
        />
      </div>

      {/* ── More rules expander ───────────────────────────────────────────── */}
      <div className="rule-expander">
        <button
          type="button"
          className="rule-expander-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className="rule-expander-chevron" aria-hidden="true">
            {moreOpen ? '▾' : '▸'}
          </span>
          {moreOpen ? 'Fewer rules' : 'More rules'}
          {!moreOpen && collapsedHasValue && (
            <span className="rule-expander-active-badge" aria-label="some rules active">
              ●
            </span>
          )}
        </button>
      </div>

      {/* ── Below the fold ───────────────────────────────────────────────── */}
      {moreOpen && (
        <>
          {/* Name contains */}
          <div className="rule-row">
            <span className="rule-label">Name contains</span>
            <input
              type="text"
              value={filter.nameContains || ''}
              onChange={(e) => patch({ nameContains: e.target.value })}
              placeholder="e.g. dragon, sword..."
            />
          </div>

          {/* Mana cost */}
          <div className="rule-row">
            <span className="rule-label">
              Mana cost{' '}
              <InfoTip
                label="mana cost filter"
                text="Exact mana cost match. Use Scryfall syntax with curly braces, e.g. {2}{G}{W} or {1}{R/W}. Leave blank to ignore."
              />
            </span>
            <input
              type="text"
              value={filter.manaCost || ''}
              onChange={(e) => patch({ manaCost: e.target.value })}
              placeholder="{2}{G}{W}"
            />
          </div>

          {/* Commander eligibility */}
          <div className="rule-row">
            <span className="rule-label">
              Commander{' '}
              <InfoTip
                label="commander eligibility"
                text="Matches legal commanders: legendary creatures and cards that say 'can be your commander' (e.g. planeswalker-commanders), legal in the Commander format."
              />
            </span>
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
          </div>

          {/* Proxy */}
          <div className="rule-row">
            <span className="rule-label">
              Proxy{' '}
              <InfoTip
                label="proxy filter"
                text="Matches cards flagged as proxies — stand-in copies with no market value. Use this to keep proxies out of binders meant for real cards, or to route them into a dedicated proxy binder."
              />
            </span>
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
          </div>

          {/* Sets */}
          <div className="rule-row" ref={setsRowRef}>
            <span className="rule-label">Sets</span>
            <SetMultiSelect
              options={ownedSets}
              selected={filter.setCodes || []}
              onChange={(next) => patch({ setCodes: next })}
            />
          </div>

          {/* EDHREC */}
          <div className="rule-row">
            <span className="rule-label">
              EDHREC popularity{' '}
              <InfoTip
                label="EDHREC popularity"
                text="EDHREC tracks how often each card appears in EDH/Commander decks. Lower rank = more popular. Top 100 = roughly the most-played 100 cards across the format."
              />
            </span>
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
          </div>

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
        </>
      )}
    </>
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
  if (f.priceMin !== undefined && f.priceMax !== undefined && f.priceMin > f.priceMax) {
    return "Price minimum can't exceed maximum";
  }
  if (f.cmcMin !== undefined && f.cmcMax !== undefined && f.cmcMin > f.cmcMax) {
    return "Mana value minimum can't exceed maximum";
  }
  if (f.priceMin !== undefined && f.priceMin < 0) return "Price can't be negative";
  if (f.cmcMin !== undefined && f.cmcMin < 0) return "Mana value can't be negative";
  if (f.edhrecRankMax !== undefined && f.edhrecRankMax < 1) {
    return 'EDHREC top N must be at least 1';
  }
  return null;
}

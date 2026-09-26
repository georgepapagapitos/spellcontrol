import { useState, useEffect, useMemo, useRef } from 'react';
import { currencySymbol } from '../lib/currency';
import { isFilterEmpty } from '../lib/rules';
import { countBinderMatches } from '../lib/binder-counts';
import { cardTagLabel } from '../lib/card-tags';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { InfoTip } from './InfoTip';
import { OverflowMenu } from './OverflowMenu';
import { SegmentedControl, type Option } from './shared/form';
import { BinderRow as RuleRow, FilterFieldEditor, NumberRangeInput } from './FilterFieldEditor';
import { RuleFieldContext } from './RuleFieldContext';
import { RuleFieldPicker } from './RuleFieldPicker';
import { SetFilterPicker } from './SetFilterPicker';
import { filterFieldSpec, setFilterFields, type FilterFieldId } from '../lib/filter-fields';
import type {
  BinderFilter,
  BinderFilterGroup,
  ChipExpression,
  ColorChoice,
  EnrichedCard,
  Rarity,
} from '../types';
import { Button } from '@/components/shared/Button';

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

/** A yes/no/either predicate as a segmented control's value. */
type TriState = 'any' | 'is' | 'not';
const TRI_STATE_OPTIONS: Option<TriState>[] = [
  { value: 'any', label: 'Any' },
  { value: 'is', label: 'Is' },
  { value: 'not', label: 'Is not' },
];
const triState = (v: boolean | undefined): TriState => (v === undefined ? 'any' : v ? 'is' : 'not');
const fromTriState = (v: TriState): boolean | undefined => (v === 'any' ? undefined : v === 'is');

/**
 * A rule group's badge count (B4-01). `matchCount` always comes from
 * `countBinderMatches`, which treats an empty filter as a binder's
 * deliberate catch-all — correct for a binder, wrong for a list (whose empty
 * rule matches nothing, per `dynamic-list.ts`). Returns null to mean "no rule
 * yet" rather than surfacing the binder's catch-all number to a list caller.
 */
export function groupBadgeCount(
  filter: BinderFilter,
  matchCount: number,
  emptyGroupMatchesNothing: boolean
): number | null {
  return emptyGroupMatchesNothing && isFilterEmpty(filter) ? null : matchCount;
}

/* ─────────────────────────── filter-group UI ─────────────────────────── */

/**
 * Renders the OR-list of rule groups. A binder has RULES; each rule is a card
 * that matches when every one of its CONDITIONS does ("Match all of"), and the
 * binder takes a card that matches any rule. Each group is a `<fieldset>`
 * whose `<legend>` names it for assistive tech; an "or" divider sits between
 * groups (decorative — the meaning is in the fieldset list). One button
 * follows the list to add another rule.
 */
// Exported for reuse by the dynamic-list rule editor (ListRuleEditor) — the
// group list is pure rule-editing UI with no binder-specific chrome.
export function FilterGroupList({
  groups,
  cards,
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
  revealSetsSignal = 0,
  emptyGroupMatchesNothing = false,
}: {
  groups: BinderFilterGroup[];
  cards: EnrichedCard[];
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
  /** Bumped by the "A set binder" start: add a Sets condition to the first
   *  rule and scroll it into view. */
  revealSetsSignal?: number;
  /** A binder's empty rule group is a deliberate catch-all (matches every
   *  remaining card); a list's empty rule matches nothing (see
   *  `dynamic-list.ts`'s `isRuleEmpty`). `countBinderMatches` always computes
   *  the binder semantics, so a list caller sets this to correct the per-group
   *  badge to match its own "no rule yet" reality instead of the binder's
   *  catch-all count (B4-01). */
  emptyGroupMatchesNothing?: boolean;
}) {
  // Per-group counts are raw rule matches. The whole-binder answer (and what
  // "keep printings together" pulls in) belongs to the host's footer, which
  // is the one place a count is stated — not a second total down here.
  const { perGroup } = useMemo(() => countBinderMatches(cards, groups, false), [groups, cards]);

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
            revealSetsSignal={i === 0 ? revealSetsSignal : 0}
            emptyGroupMatchesNothing={emptyGroupMatchesNothing}
          />
          {i < groups.length - 1 && (
            <div className="filter-group-or" aria-hidden="true">
              <span>or</span>
            </div>
          )}
        </div>
      ))}

      <div className="filter-group-footer">
        <Button onClick={onAdd} className="btn-add-group">
          + Or match other cards too
        </Button>
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
  revealSetsSignal,
  emptyGroupMatchesNothing,
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
  revealSetsSignal: number;
  emptyGroupMatchesNothing: boolean;
}) {
  const cardRef = useRef<HTMLFieldSetElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Renaming is an explicit act from the ⋯ menu. The group used to open with
  // an always-editable name field, which made every rule look like a form to
  // fill in before it could do anything.
  const [renaming, setRenaming] = useState(false);

  // A freshly added rule hands focus to its "Add condition" button, which is
  // the next thing anyone does with an empty rule.
  useEffect(() => {
    if (!autofocus) return;
    cardRef.current?.querySelector<HTMLButtonElement>('.btn-add-rule')?.focus();
    onAutofocusHandled();
  }, [autofocus, onAutofocusHandled]);

  useEffect(() => {
    if (renaming) nameRef.current?.select();
  }, [renaming]);

  const summary = autoSummary(group.filter);
  const name = group.name?.trim() ?? '';
  const displayLabel = name || summary || `Rule ${index + 1}`;
  const badgeCount = groupBadgeCount(group.filter, matchCount, emptyGroupMatchesNothing);

  return (
    <fieldset className="filter-group" ref={cardRef}>
      <legend className="sr-only">{displayLabel}</legend>
      <div className="filter-group-head">
        {renaming ? (
          <input
            ref={nameRef}
            className="filter-group-name"
            value={group.name ?? ''}
            onChange={(e) => onSetName(e.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                // Escape here closes the field, not the dialog around it.
                e.stopPropagation();
                e.preventDefault();
                setRenaming(false);
              }
            }}
            placeholder={summary || 'Name this rule'}
            aria-label={`Name for rule ${index + 1}`}
          />
        ) : name ? (
          <span className="filter-group-title">{name}</span>
        ) : (
          <span className="filter-group-title is-generic">Match all of</span>
        )}
        {/* `aria-live` because this is the feedback loop of the whole editor:
            you change a condition to watch this number move. */}
        <span
          className="filter-group-count"
          aria-live="polite"
          aria-label={
            badgeCount === null
              ? `Rule ${index + 1} has no conditions yet`
              : `Rule ${index + 1} matches ${badgeCount} ${badgeCount === 1 ? 'card' : 'cards'}`
          }
        >
          {badgeCount === null ? '' : badgeCount.toLocaleString()}
        </span>
        <OverflowMenu
          ariaLabel={`Actions for rule: ${displayLabel}`}
          items={[
            { label: name ? 'Rename' : 'Name this rule', onClick: () => setRenaming(true) },
            { label: 'Duplicate', onClick: onDuplicate },
            {
              label: total <= 1 ? 'Remove (a binder keeps one rule)' : 'Remove',
              onClick: onRemove,
              danger: true,
              disabled: total <= 1,
            },
          ]}
        />
      </div>
      {name && <span className="filter-group-sub">Match all of</span>}
      <FilterGroupFields
        filter={group.filter}
        onPatch={onPatchFilter}
        ownedSets={ownedSets}
        typeSuggestions={typeSuggestions}
        oracleSuggestions={oracleSuggestions}
        revealSetsSignal={revealSetsSignal}
        emptyGroupMatchesNothing={emptyGroupMatchesNothing}
      />
    </fieldset>
  );
}

/**
 * The condition rows that make up one rule. A row exists because its field is
 * SET (STYLE_GUIDE § Rule & filter editors): fields with a value render, plus
 * any the user just added from the "Add condition" picker.
 */
function FilterGroupFields({
  filter,
  onPatch,
  ownedSets,
  typeSuggestions,
  oracleSuggestions,
  revealSetsSignal = 0,
  emptyGroupMatchesNothing = false,
}: {
  filter: BinderFilter;
  onPatch: (p: Partial<BinderFilter>) => void;
  ownedSets: { code: string; label: string }[];
  typeSuggestions: string[];
  oracleSuggestions: string[];
  /** Bumped by the "A set binder" start — add a Sets row and reveal it. */
  revealSetsSignal?: number;
  /** See `groupBadgeCount` — also corrects the "no conditions yet" hint's
   *  wording for a list, whose empty rule matches nothing rather than catching
   *  every remaining card. */
  emptyGroupMatchesNothing?: boolean;
}) {
  const patch = onPatch;
  const edhrecEnabled = filter.edhrecRankMax !== undefined;
  const setsRowRef = useRef<HTMLDivElement>(null);

  // Fields the user added that don't hold a value yet. A field with a value is
  // visible on its own account (`setFilterFields`), so this only has to carry
  // the gap between "I picked Rarity" and "I typed a rarity into it".
  const [added, setAdded] = useState<Set<FilterFieldId>>(() =>
    revealSetsSignal > 0 ? new Set<FilterFieldId>(['setCodes']) : new Set()
  );
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

  // "A set binder": reveal + scroll to the Sets row. Render-phase rising-edge
  // compare, so the lint-discouraged setState-in-effect isn't needed. Signal 0
  // = no reveal, so editing an existing binder is unaffected.
  const [prevRevealSignal, setPrevRevealSignal] = useState(revealSetsSignal);
  if (revealSetsSignal !== prevRevealSignal) {
    setPrevRevealSignal(revealSetsSignal);
    if (revealSetsSignal > 0) setAdded((prev) => new Set(prev).add('setCodes'));
  }
  useEffect(() => {
    if (revealSetsSignal === 0) return;
    const raf = requestAnimationFrame(() => {
      setsRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setsRowRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [revealSetsSignal]);

  return (
    <RuleFieldContext.Provider value={visibility}>
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
          placeholder="creature, angel, legendary"
        />
      </RuleRow>

      {/* Colors */}
      <RuleRow fieldId="colors" label="Color identity">
        <ChipExpressionBuilder
          options={COLORS.map((c) => ({ value: c.key, label: c.label }))}
          value={filter.colors ?? EMPTY_EXPR}
          onChange={(next) => patch({ colors: next })}
          defaultJoiner="OR"
          placeholder="Add color…"
        />
      </RuleRow>

      {/* Rarity */}
      <RuleRow fieldId="rarities" label="Rarity">
        <ChipExpressionBuilder
          options={RARITIES.map((r) => ({ value: r, label: r }))}
          value={filter.rarities ?? EMPTY_EXPR}
          onChange={(next) => patch({ rarities: next })}
          defaultJoiner="OR"
          // A card has exactly ONE rarity, so "rare AND mythic" can never match
          // anything. The collection Filters dialog already locked this; the
          // binder editor let you build the empty set by hand.
          lockJoiner="OR"
          placeholder="Add rarity…"
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
          step={0.01}
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
          placeholder="dragon, sword"
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
              text="Exact mana cost match. Use Scryfall syntax with curly braces, like {2}{G}{W} or {1}{R/W}. Leave blank to ignore."
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
              text="Matches legal commanders: legendary creatures and any card that says “can be your commander”, including planeswalker-commanders."
            />
          </>
        }
      >
        <SegmentedControl
          ariaLabel="Commander eligibility"
          value={triState(filter.commanderEligible)}
          options={TRI_STATE_OPTIONS}
          onChange={(v) => patch({ commanderEligible: fromTriState(v) })}
        />
      </RuleRow>

      {/* Proxy */}
      <RuleRow
        fieldId="proxy"
        label={
          <>
            Proxy{' '}
            <InfoTip
              label="proxy filter"
              text="Matches cards flagged as proxies: stand-ins with no market value."
            />
          </>
        }
      >
        <SegmentedControl
          ariaLabel="Proxy"
          value={triState(filter.proxy)}
          options={TRI_STATE_OPTIONS}
          onChange={(v) => patch({ proxy: fromTriState(v) })}
        />
      </RuleRow>

      {/* Sets */}
      <RuleRow fieldId="setCodes" label="Sets" rowRef={setsRowRef}>
        <SetFilterPicker
          options={ownedSets.map((o) => ({ code: o.code, label: o.label }))}
          value={new Set(filter.setCodes ?? [])}
          onChange={(next) => patch({ setCodes: [...next] })}
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
            aria-label="Number of most popular EDH cards"
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
            className="rule-number-input"
          />
          <span className="rule-field-note">most popular EDH cards</span>
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
            {emptyGroupMatchesNothing
              ? 'No conditions yet. This rule matches nothing until you add one.'
              : 'No conditions yet. This rule takes every card the binders above leave over.'}
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

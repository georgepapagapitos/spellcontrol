/**
 * Shared filter-field rows used by both BinderEditor's FilterGroupFields and
 * CollectionFiltersDialog. Extracts the common ChipExpressionBuilder rows and
 * a deduplicated NumberRangeInput so neither consumer has to define its own.
 *
 * CMC and Price rows are NOT rendered here — both consumers position them
 * differently relative to other controls, so they use the exported
 * NumberRangeInput directly. FilterFieldEditor covers the rows that are
 * structurally identical in both consumers.
 */
import type { ReactNode } from 'react';
import type { BinderFilter, ChipExpression } from '../types';
import { SUPERTYPES, TYPES } from '../lib/card-types';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

// ── Closed-vocabulary option lists ──────────────────────────────────────────
// Defined once here so neither BinderEditor nor CollectionFiltersDialog needs
// its own copy. Shape is `{ value, label }` — matches ChipExpressionBuilder's
// `options` prop directly.

const SHARED_FORMAT_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'modern', label: 'Modern' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'commander', label: 'Commander' },
  { value: 'pauper', label: 'Pauper' },
];

const SHARED_LAYOUT_OPTIONS = [
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

const SHARED_TREATMENT_OPTIONS = [
  { value: 'fullart', label: 'Full art' },
  { value: 'extendedart', label: 'Extended art' },
  { value: 'showcase', label: 'Showcase' },
  { value: 'etched', label: 'Etched' },
  { value: 'inverted', label: 'Inverted' },
];

const SHARED_BORDER_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'borderless', label: 'Borderless' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
];

const SHARED_FINISH_OPTIONS = [
  { value: 'nonfoil', label: 'Normal' },
  { value: 'foil', label: 'Foil' },
  { value: 'etched', label: 'Etched' },
];

/**
 * Pair of min/max number inputs. Shared between BinderEditor and
 * CollectionFiltersDialog — previously each file kept its own copy.
 */
export function NumberRangeInput({
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

export interface FilterFieldEditorProps {
  value: BinderFilter;
  onPatch: (p: Partial<BinderFilter>) => void;
  subtypeSuggestions?: string[];
  oracleSuggestions?: string[];
  /**
   * Show supertype/type/subtype rows. BinderEditor shows them in the below-fold
   * section. CollectionFiltersDialog hides them because TypeLineExpressionBuilder
   * classifies tokens into those sub-fields above the shared rows.
   */
  showTypeRows?: boolean;
  /**
   * Show the Finish row. Collection page passes true (physical copy field).
   * BinderEditor renders its own Finishes row and passes false (or omits).
   */
  showFinish?: boolean;
  /**
   * Markup variant for the row wrappers:
   * - 'binder'  (default) — uses `rule-row` / `rule-label` classes from
   *   BinderEditor's modal (label inline at 180 px).
   * - 'dialog'  — uses `collection-filters-section` /
   *   `collection-filters-section-label` (label stacks above the control).
   */
  variant?: 'binder' | 'dialog';
}

/**
 * Renders the filter field rows common to BinderEditor's FilterGroupFields
 * and CollectionFiltersDialog:
 *   Oracle · Legality · Layout · Treatment · Border · Finish (opt)
 *   · Supertype · Type · Subtype (all opt, via showTypeRows)
 *
 * Rarity, CMC, and Price are NOT rendered here — callers position them
 * differently (e.g. BinderEditor puts Rarity above the fold; both consumers
 * use NumberRangeInput directly for CMC/Price). FilterFieldEditor covers the
 * rows that are fully identical in both consumers.
 *
 * No expand/collapse logic — callers control their own visibility.
 */
/** Row wrapper for BinderEditor variant (inline label at 180 px). */
function BinderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rule-row">
      <span className="rule-label">{label}</span>
      {children}
    </div>
  );
}

/** Row wrapper for CollectionFiltersDialog variant (label stacks above). */
function DialogRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="collection-filters-section">
      <div className="collection-filters-section-label">{label}</div>
      {children}
    </section>
  );
}

export function FilterFieldEditor({
  value,
  onPatch,
  subtypeSuggestions = [],
  oracleSuggestions = [],
  showTypeRows = false,
  showFinish = false,
  variant = 'binder',
}: FilterFieldEditorProps) {
  const isBinder = variant === 'binder';
  const Row = isBinder ? BinderRow : DialogRow;

  return (
    <>
      {/* Oracle text */}
      <Row label="Oracle text">
        <ChipExpressionBuilder
          value={value.oracleChips ?? EMPTY_EXPR}
          onChange={(next) => onPatch({ oracleChips: next })}
          suggestions={oracleSuggestions}
          defaultJoiner="OR"
          placeholder={isBinder ? 'e.g. flying, draw a card' : 'e.g. flying, draw a card…'}
        />
      </Row>

      {/* Format/Legality */}
      <Row label={isBinder ? 'Legalities' : 'Format'}>
        <ChipExpressionBuilder
          options={SHARED_FORMAT_OPTIONS}
          value={value.legalities ?? EMPTY_EXPR}
          onChange={(next) => onPatch({ legalities: next })}
          defaultJoiner="OR"
          placeholder="Add format…"
        />
      </Row>

      {/* Layout */}
      <Row label="Layout">
        <ChipExpressionBuilder
          options={SHARED_LAYOUT_OPTIONS}
          value={value.layouts ?? EMPTY_EXPR}
          onChange={(next) => onPatch({ layouts: next })}
          defaultJoiner="OR"
          lockJoiner="OR"
          placeholder="Add layout…"
        />
      </Row>

      {/* Treatment */}
      <Row label="Treatment">
        <ChipExpressionBuilder
          options={SHARED_TREATMENT_OPTIONS}
          value={value.treatments ?? EMPTY_EXPR}
          onChange={(next) => onPatch({ treatments: next })}
          defaultJoiner="OR"
          placeholder="Add treatment…"
        />
      </Row>

      {/* Border */}
      <Row label="Border">
        <ChipExpressionBuilder
          options={SHARED_BORDER_OPTIONS}
          value={value.borderColors ?? EMPTY_EXPR}
          onChange={(next) => onPatch({ borderColors: next })}
          defaultJoiner="OR"
          lockJoiner="OR"
          placeholder="Add border…"
        />
      </Row>

      {/* Finish — collection-page only (physical copy field) */}
      {showFinish && (
        <Row label="Finish">
          <ChipExpressionBuilder
            options={SHARED_FINISH_OPTIONS}
            value={value.finishes ?? EMPTY_EXPR}
            onChange={(next) => onPatch({ finishes: next })}
            defaultJoiner="OR"
            lockJoiner="OR"
            placeholder="Add finish…"
          />
        </Row>
      )}

      {/* Supertype / Type / Subtype — BinderEditor shows these; collection dialog hides
          them because TypeLineExpressionBuilder handles classification above */}
      {showTypeRows && (
        <>
          {/* Supertype */}
          <Row label="Supertype">
            <ChipExpressionBuilder
              options={SUPERTYPES.map((s) => ({
                value: s,
                label: s.charAt(0).toUpperCase() + s.slice(1),
              }))}
              value={value.supertypeChips ?? EMPTY_EXPR}
              onChange={(next) => onPatch({ supertypeChips: next })}
              defaultJoiner="OR"
              placeholder="e.g. legendary, basic"
            />
          </Row>

          {/* Type (exact primary type) */}
          <Row label="Type">
            <ChipExpressionBuilder
              options={TYPES.map((t) => ({
                value: t,
                label: t.charAt(0).toUpperCase() + t.slice(1),
              }))}
              value={value.typeTokenChips ?? EMPTY_EXPR}
              onChange={(next) => onPatch({ typeTokenChips: next })}
              defaultJoiner="OR"
              placeholder="e.g. creature, instant"
            />
          </Row>

          {/* Subtype */}
          <Row label="Subtype">
            <ChipExpressionBuilder
              value={value.subtypeChips ?? EMPTY_EXPR}
              onChange={(next) => onPatch({ subtypeChips: next })}
              suggestions={subtypeSuggestions}
              defaultJoiner="OR"
              placeholder="e.g. angel, equipment"
            />
          </Row>
        </>
      )}
    </>
  );
}

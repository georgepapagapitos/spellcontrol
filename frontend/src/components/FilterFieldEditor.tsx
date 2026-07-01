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
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { BinderFilter, ChipExpression, ScryfallQueryRule } from '../types';
import { SUPERTYPES, TYPES } from '../lib/card-types';
import { cardTagLabel, listCardTags, useCardTagsReady } from '../lib/card-tags';
import { searchCardsLive } from '@/deck-builder/services/scryfall/client';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { InfoTip } from './InfoTip';

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
   * Show the "Oracle tags" row (Scryfall otag picker). Binder-only — the
   * collection filter dialog matches against `s.cards`, which isn't decorated
   * with tags, so it stays off there. When true, the tag snapshot is loaded
   * lazily on mount.
   */
  showOracleTags?: boolean;
  /**
   * Show the "Scryfall query" row — a free-text Scryfall search (e.g.
   * "is:shockland") snapshot-resolved to oracle ids against the live API.
   * Binder-only: matching needs `card.oracleId`, which the collection filter
   * dialog's predicate doesn't use.
   */
  showScryfallQuery?: boolean;
  /**
   * Show the Finish row. Collection page passes true (physical copy field).
   * BinderEditor renders its own Finishes row and passes false (or omits).
   */
  showFinish?: boolean;
  /**
   * Content facets that need Scryfall fields not every consumer carries. All
   * default true (binder/collection have the fields); shared views pass false
   * because the slim public share payload lacks oracleText / legalities /
   * frameEffects / borderColor, so these rows would silently match nothing.
   */
  showOracleText?: boolean;
  showLegality?: boolean;
  showTreatment?: boolean;
  showBorder?: boolean;
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
function BinderRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rule-row">
      <span className="rule-label">{label}</span>
      {children}
    </div>
  );
}

/** Row wrapper for CollectionFiltersDialog variant (label stacks above). */
function DialogRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className="collection-filters-section">
      <div className="collection-filters-section-label">{label}</div>
      {children}
    </section>
  );
}

/**
 * Free-text Scryfall query, snapshot-resolved to oracle ids. The draft lives in
 * local state and is only committed (with its resolved ids) on "Run" — so the
 * binder isn't dirtied by typing, and an edited-but-unrun query is visibly
 * pending. Scryfall's curated filters can't run offline, hence the snapshot +
 * manual re-run model rather than live evaluation.
 */
const MAX_RESOLVED_IDS = 2000;

function ScryfallQueryRow({
  value,
  onChange,
}: {
  value?: ScryfallQueryRule;
  onChange: (next: ScryfallQueryRule | undefined) => void;
}) {
  const [draft, setDraft] = useState(value?.query ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // The draft seeds from the persisted query on mount; the caller keys this
  // component by that query, so it remounts (re-seeding) when the rule changes
  // identity beneath us (group duplicated, editor reopened on a different rule).
  const trimmed = draft.trim();
  const applied = value?.resolvedAt !== undefined && value.query === trimmed;
  const canRun = trimmed.length > 0 && !loading && !applied;

  const run = useCallback(async () => {
    const q = draft.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setTruncated(false);
    try {
      const ids = new Set<string>();
      let page = 1;
      let hasMore = true;
      let cut = false;
      while (hasMore) {
        const res = await searchCardsLive(q, [], {
          skipFormatFilter: true,
          skipColorFilter: true,
          page,
        });
        for (const c of res.data) if (c.oracle_id) ids.add(c.oracle_id);
        if (ids.size >= MAX_RESOLVED_IDS) {
          cut = true;
          break;
        }
        hasMore = res.has_more;
        page++;
      }
      setTruncated(cut);
      onChange({ query: q, oracleIds: [...ids], resolvedAt: Date.now() });
    } catch (e) {
      // Scryfall 404s a query that matches nothing — that's a valid empty
      // result, not a failure.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404')) {
        onChange({ query: q, oracleIds: [], resolvedAt: Date.now() });
      } else {
        setError('Search failed — check the query syntax and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [draft, onChange]);

  const clear = useCallback(() => {
    setDraft('');
    setError(null);
    setTruncated(false);
    onChange(undefined);
  }, [onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={draft}
          placeholder="e.g. is:shockland"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canRun) {
              e.preventDefault();
              void run();
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" className="btn" onClick={() => void run()} disabled={!canRun}>
          {loading ? 'Running…' : applied ? 'Run' : value?.resolvedAt ? 'Re-run' : 'Run'}
        </button>
        {value !== undefined && (
          <button type="button" className="btn btn-ghost" onClick={clear} disabled={loading}>
            Clear
          </button>
        )}
      </div>
      <span
        role="status"
        aria-live="polite"
        style={{ fontSize: '0.78rem', color: error ? 'var(--danger)' : 'var(--text-muted)' }}
      >
        {error
          ? error
          : loading
            ? 'Searching Scryfall…'
            : value?.resolvedAt !== undefined
              ? `${value.oracleIds.length.toLocaleString()} ${value.oracleIds.length === 1 ? 'card' : 'cards'} matched${truncated ? ` (capped at ${MAX_RESOLVED_IDS.toLocaleString()})` : ''} · resolved ${new Date(value.resolvedAt).toLocaleDateString()}${applied ? '' : ' · edited — re-run to apply'}`
              : trimmed
                ? 'Press Run to resolve this query.'
                : 'Matches the live Scryfall result set, snapshot to your owned cards.'}
      </span>
    </div>
  );
}

export function FilterFieldEditor({
  value,
  onPatch,
  subtypeSuggestions = [],
  oracleSuggestions = [],
  showTypeRows = false,
  showOracleTags = false,
  showScryfallQuery = false,
  showFinish = false,
  showOracleText = true,
  showLegality = true,
  showTreatment = true,
  showBorder = true,
  variant = 'binder',
}: FilterFieldEditorProps) {
  const isBinder = variant === 'binder';
  const Row = isBinder ? BinderRow : DialogRow;

  const tagsReady = useCardTagsReady(showOracleTags);
  const tagOptions = useMemo(
    () => (tagsReady ? listCardTags().map((t) => ({ value: t, label: cardTagLabel(t) })) : []),
    [tagsReady]
  );

  return (
    <>
      {/* Oracle text */}
      {showOracleText && (
        <Row label="Oracle text">
          <ChipExpressionBuilder
            value={value.oracleChips ?? EMPTY_EXPR}
            onChange={(next) => onPatch({ oracleChips: next })}
            suggestions={oracleSuggestions}
            defaultJoiner="OR"
            placeholder={isBinder ? 'e.g. flying, draw a card' : 'e.g. flying, draw a card…'}
          />
        </Row>
      )}

      {/* Oracle tags (Scryfall otags) — precise semantic concepts that beat
          oracle-text substrings (e.g. "mana-rock" vs the word "add"). */}
      {showOracleTags && (
        <Row
          label={
            <>
              Oracle tags{' '}
              <InfoTip
                label="oracle tags filter"
                text="Scryfall's community-curated card tags (otags) — pick a concept like 'Mana rock' or 'Removal' and the binder catches every card Scryfall tags that way. More precise than oracle text: 'Mana rock' won't mismatch the word 'addition' the way text 'add' does."
              />
            </>
          }
        >
          <ChipExpressionBuilder
            options={tagOptions}
            value={value.oracleTagChips ?? EMPTY_EXPR}
            onChange={(next) => onPatch({ oracleTagChips: next })}
            defaultJoiner="OR"
            placeholder={tagsReady ? 'Add tag…' : 'Loading tags…'}
          />
        </Row>
      )}

      {/* Scryfall query — resolved to oracle ids against the live API. */}
      {showScryfallQuery && (
        <Row
          label={
            <>
              Scryfall query{' '}
              <InfoTip
                label="Scryfall query filter"
                text="Run any Scryfall search (e.g. is:shockland, is:dual, t:goblin o:haste) and the binder catches every owned card it returns. Scryfall's curated filters can't run offline, so we snapshot the results — re-run after new sets release to pick up new printings."
              />
            </>
          }
        >
          <ScryfallQueryRow
            key={value.scryfallQuery?.query ?? ''}
            value={value.scryfallQuery}
            onChange={(next) => onPatch({ scryfallQuery: next })}
          />
        </Row>
      )}

      {/* Format/Legality */}
      {showLegality && (
        <Row label={isBinder ? 'Legalities' : 'Format'}>
          <ChipExpressionBuilder
            options={SHARED_FORMAT_OPTIONS}
            value={value.legalities ?? EMPTY_EXPR}
            onChange={(next) => onPatch({ legalities: next })}
            defaultJoiner="OR"
            placeholder="Add format…"
          />
        </Row>
      )}

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
      {showTreatment && (
        <Row label="Treatment">
          <ChipExpressionBuilder
            options={SHARED_TREATMENT_OPTIONS}
            value={value.treatments ?? EMPTY_EXPR}
            onChange={(next) => onPatch({ treatments: next })}
            defaultJoiner="OR"
            placeholder="Add treatment…"
          />
        </Row>
      )}

      {/* Border */}
      {showBorder && (
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
      )}

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

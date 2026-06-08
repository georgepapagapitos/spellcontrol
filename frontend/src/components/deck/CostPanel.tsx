import './CostPanel.css';
import { type JSX, useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Check } from 'lucide-react';
import {
  autoCheckToTarget,
  type CostConfidence,
  type CostPlan,
  type CostSwapRow,
} from '@/deck-builder/services/deckBuilder/costAnalyzer';
import { useCardCarousel } from './useCardCarousel';
import { VerdictBadge, type VerdictTone } from './VerdictBadge';
import { useCardThumb } from '@/lib/card-thumbs';

export interface CostPanelProps {
  plan: CostPlan;
  /** Commit the selected swaps. Each pair removes one card and adds its cheaper suggestion. */
  onApply: (swaps: Array<{ removeName: string; addName: string }>) => void | Promise<void>;
  /** Disables Apply + checkboxes while a commit is in flight. */
  applying?: boolean;
}

/** Drop-in + sidegrade default to checked; budget picks are opt-in. */
const DEFAULT_CHECKED: CostConfidence[] = ['drop-in', 'sidegrade'];

const CONFIDENCE_LABEL: Record<CostConfidence, string> = {
  'drop-in': 'Drop-in',
  sidegrade: 'Sidegrade',
  budget: 'Budget',
};

/* The Cost panel's own scale slots onto the shared verdict tones: a drop-in is a
   safe gain (success), a sidegrade is lateral (info, like Substitute), a budget
   pick is a real downgrade (warn). The chip keeps its confidence word. */
const CONFIDENCE_TONE: Record<CostConfidence, VerdictTone> = {
  'drop-in': 'success',
  sidegrade: 'info',
  budget: 'warn',
};

function fmt(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Card thumb, or a skeleton while the CDN art resolves (no rate-limited img). */
function CostThumb({ url }: { url: string | undefined }): JSX.Element {
  return url ? (
    <img className="cost-thumb" src={url} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className="cost-thumb cost-thumb-ph" aria-hidden />
  );
}

function SwapRow({
  row,
  checked,
  onToggle,
  onPreview,
  disabled,
}: {
  row: CostSwapRow;
  checked: boolean;
  onToggle: () => void;
  /** Open the card-detail carousel for this swap, starting at `name`. */
  onPreview: (name: string) => void;
  disabled?: boolean;
}) {
  const inclusionDelta = `${Math.round(row.currentInclusion)}% → ${Math.round(
    row.suggestionInclusion
  )}%`;
  const aria = `Swap ${row.currentName} for ${row.suggestionName}, save ${fmt(row.savings)}`;
  // Resolve CDN art by name (cached + batched) when the row didn't carry a URL.
  const resolvedCurrent = useCardThumb(row.currentImageUrl ? undefined : row.currentName, 'small');
  const currentThumb = row.currentImageUrl ?? resolvedCurrent;
  const suggestionThumb = useCardThumb(row.suggestionName, 'small');
  // Tap a card to preview it (and swipe to its swap partner) without toggling
  // the checkbox.
  const previewClick = (name: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPreview(name);
  };

  return (
    <li className={`cost-row is-${row.confidence}${checked ? '' : ' is-unchecked'}`}>
      <label className="cost-row-label">
        <input
          type="checkbox"
          className="cost-checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          aria-label={aria}
        />

        <button
          type="button"
          className="cost-card cost-card-current"
          onClick={previewClick(row.currentName)}
          aria-label={`Preview ${row.currentName}`}
        >
          <CostThumb url={currentThumb} />
          <span className="cost-card-text">
            <span className="cost-card-name">{row.currentName}</span>
            <span className="cost-card-price">{fmt(row.currentPrice)}</span>
          </span>
        </button>

        <span className="cost-arrow" aria-hidden>
          →
        </span>

        <button
          type="button"
          className="cost-card cost-card-suggestion"
          onClick={previewClick(row.suggestionName)}
          aria-label={`Preview ${row.suggestionName}`}
        >
          <CostThumb url={suggestionThumb} />
          <span className="cost-card-text">
            <span className="cost-card-name">{row.suggestionName}</span>
            <span className="cost-card-price">{fmt(row.suggestionPrice)}</span>
          </span>
        </button>

        <span className="cost-row-meta">
          <span className="cost-savings">Save {fmt(row.savings)}</span>
          <VerdictBadge
            tone={CONFIDENCE_TONE[row.confidence]}
            label={CONFIDENCE_LABEL[row.confidence]}
          />
          <span className="cost-inclusion">{inclusionDelta}</span>
        </span>
      </label>
    </li>
  );
}

function Section({
  title,
  rows,
  checked,
  onToggle,
  onPreview,
  applying,
}: {
  title: string;
  rows: CostSwapRow[];
  checked: Set<string>;
  onToggle: (id: string) => void;
  onPreview: (row: CostSwapRow, name: string) => void;
  applying: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="cost-section" aria-label={title}>
      <h3 className="cost-section-title">
        {title} <span className="cost-section-count">({rows.length})</span>
      </h3>
      <ul className="cost-rows">
        {rows.map((row) => (
          <SwapRow
            key={row.id}
            row={row}
            checked={checked.has(row.id)}
            onToggle={() => onToggle(row.id)}
            onPreview={(name) => onPreview(row, name)}
            disabled={applying}
          />
        ))}
      </ul>
    </section>
  );
}

export function CostPanel({ plan, onApply, applying = false }: CostPanelProps): JSX.Element {
  const allRows = useMemo(() => [...plan.spellRows, ...plan.landRows], [plan]);

  const carousel = useCardCarousel('Budget swap');
  // Preview a swap as a 2-card carousel: current ⇄ suggestion, so you can flip
  // between the card you'd cut and its cheaper replacement, starting at the
  // tapped one.
  const openPreview = (row: CostSwapRow, tappedName: string) =>
    void carousel.open(
      [
        { name: row.currentName, label: `Current · ${fmt(row.currentPrice)}` },
        { name: row.suggestionName, label: `Suggestion · ${fmt(row.suggestionPrice)}` },
      ],
      tappedName
    );

  // Default selection: every drop-in + sidegrade row checked.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(allRows.filter((r) => DEFAULT_CHECKED.includes(r.confidence)).map((r) => r.id))
  );
  const [target, setTarget] = useState<string>('');

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const autoSelect = useCallback(() => {
    const t = Number(target);
    if (!Number.isFinite(t)) return;
    // Enabled tiers = the confidence tiers currently represented in the checked
    // set, defaulting to drop-in + sidegrade when nothing is checked yet.
    const enabled = new Set<CostConfidence>(
      checked.size > 0
        ? allRows.filter((r) => checked.has(r.id)).map((r) => r.confidence)
        : DEFAULT_CHECKED
    );
    setChecked(autoCheckToTarget(allRows, plan.currentTotal, t, enabled, new Set()));
  }, [target, checked, allRows, plan.currentTotal]);

  const selectedSavings = useMemo(
    () => allRows.reduce((s, r) => (checked.has(r.id) ? s + r.savings : s), 0),
    [allRows, checked]
  );
  const projectedTotal = plan.currentTotal - selectedSavings;
  const selectedCount = useMemo(
    () => allRows.filter((r) => checked.has(r.id)).length,
    [allRows, checked]
  );

  const apply = useCallback(() => {
    const swaps = allRows
      .filter((r) => checked.has(r.id))
      .map((r) => ({ removeName: r.currentName, addName: r.suggestionName }));
    if (swaps.length === 0) return;
    return onApply(swaps);
  }, [allRows, checked, onApply]);

  const isEmpty = plan.spellRows.length === 0 && plan.landRows.length === 0;
  if (isEmpty) {
    return (
      <section className="cost-panel" aria-label="Cost optimizer">
        <p className="cost-empty">No cheaper role-equivalents found — this list is already lean.</p>
      </section>
    );
  }

  const applyAria = `Apply ${selectedCount} swap${selectedCount === 1 ? '' : 's'}, save ${fmt(
    Math.max(0, selectedSavings)
  )}`;

  return (
    <section className="cost-panel" aria-label="Cost optimizer">
      <div className="cost-budget" role="group" aria-label="Budget target">
        <label className="cost-budget-field">
          <span className="cost-budget-label">$ target</span>
          <input
            type="number"
            className="cost-budget-input"
            inputMode="decimal"
            min={0}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={Math.floor(plan.minTotal).toString()}
            aria-label="Budget target in dollars"
          />
        </label>
        <button
          type="button"
          className="cost-auto"
          onClick={autoSelect}
          disabled={target === '' || applying}
        >
          Auto-select to target
        </button>
      </div>

      <div className="cost-sections">
        <Section
          title="Spells"
          rows={plan.spellRows}
          checked={checked}
          onToggle={toggle}
          onPreview={openPreview}
          applying={applying}
        />
        <Section
          title="Lands"
          rows={plan.landRows}
          checked={checked}
          onToggle={toggle}
          onPreview={openPreview}
          applying={applying}
        />
      </div>

      <div className="cost-applybar" role="region" aria-label="Cost plan summary">
        <dl className="cost-totals">
          <div className="cost-total">
            <dt>Current</dt>
            <dd>{fmt(plan.currentTotal)}</dd>
          </div>
          <div className="cost-total">
            <dt>Projected</dt>
            <dd className="is-accent">{fmt(projectedTotal)}</dd>
          </div>
          <div className="cost-total">
            <dt>Savings</dt>
            <dd className="is-save">{fmt(Math.max(0, selectedSavings))}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="cost-apply"
          onClick={apply}
          disabled={selectedCount === 0 || applying}
          aria-label={applyAria}
        >
          <Check width={14} height={14} aria-hidden />
          {applying ? 'Applying…' : `Apply ${selectedCount} swap${selectedCount === 1 ? '' : 's'}`}
        </button>
      </div>

      {carousel.preview}
    </section>
  );
}

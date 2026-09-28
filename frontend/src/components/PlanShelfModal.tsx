import './PlanShelfModal.css';
import { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Modal } from './Modal';
import { Button, IconButton } from './shared/Button';
import { ChoiceList } from './shared/form';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import {
  computeShelfPlan,
  defaultCheckedRows,
  defaultPullOutOrder,
  DEFAULT_PLAN_CAPACITY,
  SHELF_STRATEGIES,
  type PullOutId,
  type ShelfPlanRow,
  type ShelfStrategyId,
} from '../lib/shelf-plan';
import { useDebouncedValue } from '../lib/use-debounced-value';

const SPLIT_SECTION_TITLE: Record<ShelfStrategyId, string> = {
  'by-color': 'Then one binder per color',
  'by-set': 'Then your biggest sets',
  'by-type': 'Then one binder per type',
  'value-then-color': 'Then by color',
};

/** Visual spine height for the shelf picture, clamped so one huge bucket
 *  doesn't dwarf the row: proportional to pages, never below a stub. */
function spineHeight(pages: number, maxPages: number): number {
  if (maxPages <= 0) return 12;
  return Math.round(12 + (pages / maxPages) * 44);
}

function Row({
  row,
  onToggle,
  reorder,
}: {
  row: ShelfPlanRow;
  onToggle: (id: string) => void;
  /** Only pull-out rows are reorderable. */
  reorder?: { onUp: () => void; onDown: () => void; canUp: boolean; canDown: boolean };
}) {
  const checkboxId = useId();
  return (
    <li className={`plan-shelf-row${row.checked ? '' : ' is-off'}`}>
      {row.section === 'catch-all' ? (
        <span
          className="plan-shelf-row-check plan-shelf-row-check--fixed"
          title="Always created, last"
        >
          <Check width={14} height={14} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">Always included</span>
        </span>
      ) : (
        <label className="plan-shelf-row-check" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={row.checked}
            onChange={() => onToggle(row.id)}
            aria-label={`Include ${row.name} in the shelf`}
          />
        </label>
      )}
      {reorder && (
        <span className="plan-shelf-row-reorder">
          <IconButton
            variant="quiet"
            label={`Move ${row.name} up`}
            disabled={!reorder.canUp}
            onClick={reorder.onUp}
            icon={<ChevronUp width={16} height={16} strokeWidth={2} />}
          />
          <IconButton
            variant="quiet"
            label={`Move ${row.name} down`}
            disabled={!reorder.canDown}
            onClick={reorder.onDown}
            icon={<ChevronDown width={16} height={16} strokeWidth={2} />}
          />
        </span>
      )}
      <span className="plan-shelf-row-swatch" style={{ background: row.color }} aria-hidden />
      <span className="plan-shelf-row-name">
        {row.name}
        <span className="plan-shelf-row-desc"> · {row.description}</span>
      </span>
      <span className="plan-shelf-row-count">{row.count.toLocaleString()}</span>
      <span className="plan-shelf-row-pages">
        {row.pages.toLocaleString()} {row.pages === 1 ? 'pg' : 'pp'}
      </span>
      {row.volumes && row.volumes.length > 1 && (
        <p className="plan-shelf-row-volumes">
          {row.name} · {row.volumes.length} volumes of {DEFAULT_PLAN_CAPACITY.toLocaleString()}
        </p>
      )}
    </li>
  );
}

/**
 * "Plan a shelf" (E496): sets up a whole collection as an ordered set of
 * binders in one go. A Modal — a bottom sheet on phones, a centered dialog
 * above, via `backdropClassName="modal-backdrop--sheet"` (the same pattern
 * `BinderVolumesSheet` uses). All the actual planning lives in the pure
 * `lib/shelf-plan.ts`; this component only holds the picker state (strategy,
 * pull-out order, which rows are checked) and renders what it computes.
 */
export function PlanShelfModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const createBinders = useCollectionStore((s) => s.createBinders);
  const deleteBinders = useCollectionStore((s) => s.deleteBinders);

  const [strategy, setStrategy] = useState<ShelfStrategyId>('by-color');
  const [pullOutOrder, setPullOutOrder] = useState<PullOutId[]>(defaultPullOutOrder);
  const [checked, setChecked] = useState<Set<string>>(() =>
    defaultCheckedRows('by-color', cards, setMap)
  );
  const [creating, setCreating] = useState(false);

  const changeStrategy = (next: ShelfStrategyId) => {
    setStrategy(next);
    // A fresh strategy proposes an entirely different bucket set — the old
    // checked ids (color keys, type keys, …) don't carry over meaningfully,
    // so every row of the new strategy starts checked, same as a first open.
    setChecked(defaultCheckedRows(next, cards, setMap));
  };

  const toggleRow = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const movePullOut = (id: PullOutId, dir: -1 | 1) =>
    setPullOutOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Live recount, debounced: a rapid run of clicks (unchecking several rows,
  // reordering twice) settles into ONE recompute instead of one per click —
  // each pass runs the real routing engine twice over the whole collection.
  const debouncedOrder = useDebouncedValue(pullOutOrder, 150);
  const debouncedChecked = useDebouncedValue(checked, 150);

  const plan = useMemo(
    () =>
      computeShelfPlan({
        strategy,
        pullOutOrder: debouncedOrder,
        checked: debouncedChecked,
        pile: cards,
        existingBinders: binders,
        allocatedCopyIds,
        setMap,
      }),
    [strategy, debouncedOrder, debouncedChecked, cards, binders, allocatedCopyIds, setMap]
  );

  const pullOutRows = plan.rows.filter((r) => r.section === 'pull-out');
  const splitRows = plan.rows.filter((r) => r.section === 'split');
  const catchAllRow = plan.rows.find((r) => r.section === 'catch-all');
  const checkedRows = plan.rows.filter((r) => r.checked);
  const maxPages = Math.max(1, ...checkedRows.map((r) => r.pages));

  const noCollection = cards.length === 0;
  const allFiled = !noCollection && plan.totals.cardCount === 0;
  // The footer button's own count: 0 whenever there's genuinely nothing to
  // create (no collection, or every card is already filed) — `plan.totals.
  // binderCount` alone would still count checked-but-empty rows and print
  // "Create 9 binders" on a button that's disabled for creating nothing.
  const creatableCount = noCollection || allFiled ? 0 : plan.totals.binderCount;

  const handleCreate = () => {
    if (plan.totals.binderCount === 0 || creating) return;
    setCreating(true);
    const inputs = plan.toCreate(binders.length);
    const created = createBinders(inputs);
    setCreating(false);
    onClose();
    toast.show({
      message: `Created ${created.length} ${created.length === 1 ? 'binder' : 'binders'}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => deleteBinders(created.map((b) => b.id)),
    });
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      className="modal plan-shelf-modal"
      backdropClassName="modal-backdrop--sheet"
    >
      <div className="modal-header">
        <h2 id={titleId}>Plan a shelf</h2>
        <IconButton
          variant="quiet"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>
      <div className="modal-body plan-shelf-body">
        {noCollection ? (
          <p className="plan-shelf-empty">
            Import your collection first. A shelf is planned from the cards you own.
          </p>
        ) : (
          <>
            <ChoiceList
              ariaLabel="Split my collection"
              value={strategy}
              onChange={changeStrategy}
              options={SHELF_STRATEGIES.map((s) => ({
                value: s.id,
                label: s.name,
                hint: s.description,
              }))}
            />

            {allFiled ? (
              <p className="plan-shelf-all-filed">
                Every card you own already has a binder. Nothing is left to plan a shelf from.
              </p>
            ) : (
              <>
                <section className="plan-shelf-section">
                  <h3 className="plan-shelf-section-title">Pull these out first</h3>
                  <p className="plan-shelf-section-hint">
                    They go at the front of the shelf, so they take their cards before the split
                    below does.
                  </p>
                  <ul className="plan-shelf-rows">
                    {pullOutRows.map((row, i) => (
                      <Row
                        key={row.id}
                        row={row}
                        onToggle={toggleRow}
                        reorder={{
                          onUp: () => movePullOut(row.id as PullOutId, -1),
                          onDown: () => movePullOut(row.id as PullOutId, 1),
                          canUp: i > 0,
                          canDown: i < pullOutRows.length - 1,
                        }}
                      />
                    ))}
                  </ul>
                </section>

                <section className="plan-shelf-section">
                  <h3 className="plan-shelf-section-title">{SPLIT_SECTION_TITLE[strategy]}</h3>
                  <ul className="plan-shelf-rows">
                    {splitRows.map((row) => (
                      <Row key={row.id} row={row} onToggle={toggleRow} />
                    ))}
                    {catchAllRow && <Row row={catchAllRow} onToggle={toggleRow} />}
                  </ul>
                </section>

                <div className="plan-shelf-summary">
                  <span className="plan-shelf-shelf" aria-hidden="true">
                    {checkedRows.map((row) => (
                      <i
                        key={row.id}
                        style={{ background: row.color, height: spineHeight(row.pages, maxPages) }}
                      />
                    ))}
                  </span>
                  <div className="plan-shelf-totals">
                    <strong>
                      {plan.totals.binderCount.toLocaleString()}{' '}
                      {plan.totals.binderCount === 1 ? 'binder' : 'binders'} ·{' '}
                      {plan.totals.cardCount.toLocaleString()}{' '}
                      {plan.totals.cardCount === 1 ? 'card' : 'cards'} · {plan.totals.leftOver} left
                      over
                    </strong>
                    <p className="plan-shelf-totals-hint">
                      Rows over {DEFAULT_PLAN_CAPACITY.toLocaleString()} cards split into volumes,
                      or raise the size later in each binder's Pages settings.
                    </p>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <div className="plan-shelf-footer-note">
          {binders.length > 0 && !noCollection && (
            <span>
              Your {binders.length.toLocaleString()} existing{' '}
              {binders.length === 1 ? 'binder stays' : 'binders stay'} in front of these
            </span>
          )}
        </div>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={creating || noCollection || allFiled || plan.totals.binderCount === 0}
        >
          {creating
            ? 'Creating…'
            : `Create ${creatableCount.toLocaleString()} ${creatableCount === 1 ? 'binder' : 'binders'}`}
        </Button>
      </div>
    </Modal>
  );
}

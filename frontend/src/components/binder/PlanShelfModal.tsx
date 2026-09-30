import './PlanShelfModal.css';
import { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Modal } from '@/components/overlays/Modal';
import { Button, IconButton } from '@/components/shared/Button';
import { ChoiceList } from '@/components/shared/form';
import { useCollectionStore } from '@/store/collection';
import { toast } from '@/store/toasts';
import { useBinderLayoutInputs } from '@/lib/binder/use-binder-layout-inputs';
import {
  computeShelfPlan,
  defaultShelfPlan,
  defaultPullOutOrder,
  DEFAULT_PLAN_CAPACITY,
  SHELF_STRATEGIES,
  type PullOutId,
  type ShelfPlanRow,
  type ShelfStrategyId,
} from '@/lib/binder/shelf-plan';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';

const SPLIT_SECTION_TITLE: Record<ShelfStrategyId, string> = {
  'by-color': 'Then one binder per color',
  'by-set': 'Then your biggest sets',
  'by-type': 'Then one binder per type',
  'value-then-color': 'Then by color',
};

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The shelf picture's spines: one per physical book, so a row that splits
 *  into volumes stands as that many binders. Height follows the book's page
 *  count against the fullest book, never below a stub. */
function shelfSpines(rows: ShelfPlanRow[]) {
  const spines = rows.flatMap((row) =>
    row.volumes && row.volumes.length > 1
      ? row.volumes.map((v) => ({
          key: `${row.id}-${v.index}`,
          color: row.color,
          pages: v.pageEnd - v.pageStart + 1,
        }))
      : [{ key: row.id, color: row.color, pages: row.pages }]
  );
  const max = Math.max(1, ...spines.map((s) => s.pages));
  return spines.map((s) => ({ ...s, height: Math.round(14 + (s.pages / max) * 42) }));
}

function Row({
  row,
  checked,
  onToggle,
  reorder,
}: {
  row: ShelfPlanRow;
  /** The row's live checkbox state. It can run a beat ahead of `row`, whose
   *  figures come from the debounced recount. */
  checked: boolean;
  onToggle: (id: string) => void;
  /** Only pull-out rows are reorderable. */
  reorder?: { onUp: () => void; onDown: () => void; canUp: boolean; canDown: boolean };
}) {
  const checkboxId = useId();
  const empty = row.count === 0;
  const volumes = row.volumes && row.volumes.length > 1 ? row.volumes.length : 0;
  return (
    <li className={`plan-shelf-row${checked ? '' : ' is-off'}${empty ? ' is-empty' : ''}`}>
      {row.section === 'catch-all' ? (
        <span
          className="plan-shelf-row-check plan-shelf-row-check--fixed"
          title="Always last, so nothing is left over"
        >
          <Check width={16} height={16} strokeWidth={2} aria-hidden />
          <span className="sr-only">Always included</span>
        </span>
      ) : (
        <label className="plan-shelf-row-check" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(row.id)}
            aria-label={`Include ${row.name} in the shelf`}
          />
        </label>
      )}
      <span className="plan-shelf-row-swatch" style={{ background: row.color }} aria-hidden />
      <span className="plan-shelf-row-text">
        <span className="plan-shelf-row-name">{row.name}</span>
        <span className="plan-shelf-row-sep" aria-hidden="true">
          {' · '}
        </span>
        <span className="plan-shelf-row-meta">
          {empty
            ? 'Nothing left for this one'
            : volumes
              ? `${row.orderLabel} · ${volumes} volumes of ${DEFAULT_PLAN_CAPACITY.toLocaleString()}`
              : row.orderLabel}
        </span>
      </span>
      <span className="plan-shelf-row-figures">
        {!empty && (
          <>
            <span className="plan-shelf-row-count">{row.count.toLocaleString()}</span>
            <span className="plan-shelf-row-pages">{plural(row.pages, 'page', 'pages')}</span>
          </>
        )}
      </span>
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
    </li>
  );
}

/** The user's own row picks, tagged with the strategy they were made under so
 *  a debounced set left over from the previous strategy never applies here. */
interface RowPicks {
  strategy: ShelfStrategyId;
  ids: Set<string>;
}

/**
 * "Plan a shelf" (E496): sets up a whole collection as an ordered set of
 * binders in one go. A Modal — a bottom sheet on phones, a centered dialog
 * above, via `backdropClassName="modal-backdrop--sheet"` (the same pattern
 * `BinderVolumesSheet` uses). All the actual planning lives in the pure
 * `lib/binder/shelf-plan.ts`; this component only holds the picker state (strategy,
 * pull-out order, which rows the user checked) and renders what it computes.
 */
export function PlanShelfModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const createBinders = useCollectionStore((s) => s.createBinders);
  const deleteBinders = useCollectionStore((s) => s.deleteBinders);

  const [strategy, setStrategy] = useState<ShelfStrategyId>('by-color');
  const [pullOutOrder, setPullOutOrder] = useState<PullOutId[]>(defaultPullOutOrder);
  // null until the user checks or unchecks a row. Until then the plan's own
  // defaults apply (every row that lands cards), and they follow the
  // collection as it hydrates instead of freezing what the first render saw.
  const [picks, setPicks] = useState<RowPicks | null>(null);
  const [creating, setCreating] = useState(false);

  // Live recount, debounced: a rapid run of clicks (unchecking several rows,
  // reordering twice) settles into ONE recompute instead of one per click,
  // since each pass runs the real routing engine over the whole collection.
  // The checkboxes and the row order read the live state, so they never lag.
  const debouncedOrder = useDebouncedValue(pullOutOrder, 150);
  const debouncedPicks = useDebouncedValue(picks, 150);
  const livePicks = picks?.strategy === strategy ? picks : null;
  const settledPicks =
    livePicks && debouncedPicks?.strategy === strategy ? debouncedPicks.ids : null;

  const plan = useMemo(() => {
    const input = {
      strategy,
      pullOutOrder: debouncedOrder,
      pile: cards,
      existingBinders: binders,
      allocatedCopyIds,
      setMap,
    };
    return settledPicks
      ? computeShelfPlan({ ...input, checked: settledPicks })
      : defaultShelfPlan(input).plan;
  }, [strategy, debouncedOrder, settledPicks, cards, binders, allocatedCopyIds, setMap]);

  const isChecked = (row: ShelfPlanRow) =>
    row.section === 'catch-all' || (livePicks ? livePicks.ids.has(row.id) : row.checked);

  const changeStrategy = (next: ShelfStrategyId) => {
    // A fresh strategy proposes an entirely different bucket set, so the old
    // picks don't carry over: the new one opens on its own defaults.
    setStrategy(next);
    setPicks(null);
  };

  const toggleRow = (id: string) =>
    setPicks((prev) => {
      const ids = new Set(
        prev?.strategy === strategy
          ? prev.ids
          : plan.rows.filter((r) => r.checked && r.section !== 'catch-all').map((r) => r.id)
      );
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { strategy, ids };
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

  const rowById = new Map(plan.rows.map((r) => [r.id, r]));
  // Pull-outs render in the live order; their figures catch up with the
  // debounced recount a beat later.
  const pullOutRows = pullOutOrder
    .map((id) => rowById.get(id))
    .filter((r): r is ShelfPlanRow => !!r);
  const splitRows = plan.rows.filter((r) => r.section === 'split');
  const catchAllRow = plan.rows.find((r) => r.section === 'catch-all');
  const creatingRows = plan.rows.filter((r) => r.creates);
  const spines = shelfSpines(creatingRows);
  const splitsIntoVolumes = creatingRows.some((r) => r.volumes && r.volumes.length > 1);

  const noCollection = cards.length === 0;
  const allFiled = !noCollection && plan.totals.cardCount === 0;
  const binderCount = noCollection || allFiled ? 0 : plan.totals.binderCount;

  const handleCreate = () => {
    if (binderCount === 0 || creating) return;
    setCreating(true);
    const created = createBinders(plan.toCreate(binders.length));
    setCreating(false);
    onClose();
    toast.show({
      message: `Created ${plural(created.length, 'binder', 'binders')}`,
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
          <p className="plan-shelf-empty">Import your collection first.</p>
        ) : allFiled ? (
          <p className="plan-shelf-empty">Every card you own already has a binder.</p>
        ) : (
          <>
            <section className="plan-shelf-section">
              <h3 className="form-section-heading">Split my collection</h3>
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
            </section>

            <section className="plan-shelf-section">
              <h3 className="form-section-heading">Pull these out first</h3>
              <p className="form-field-hint">They go first, ahead of the split below.</p>
              <ul className="plan-shelf-rows">
                {pullOutRows.map((row, i) => (
                  <Row
                    key={row.id}
                    row={row}
                    checked={isChecked(row)}
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
              <h3 className="form-section-heading">{SPLIT_SECTION_TITLE[strategy]}</h3>
              <ul className="plan-shelf-rows">
                {splitRows.map((row) => (
                  <Row key={row.id} row={row} checked={isChecked(row)} onToggle={toggleRow} />
                ))}
                {catchAllRow && <Row row={catchAllRow} checked onToggle={toggleRow} />}
              </ul>
            </section>

            <div className="plan-shelf-summary">
              <span className="plan-shelf-shelf" aria-hidden="true">
                {spines.map((s) => (
                  <i key={s.key} style={{ background: s.color, height: s.height }} />
                ))}
              </span>
              <div className="plan-shelf-totals">
                <strong>
                  {plural(plan.totals.binderCount, 'binder', 'binders')} ·{' '}
                  {plural(plan.totals.cardCount, 'card', 'cards')} ·{' '}
                  {plan.totals.leftOver.toLocaleString()} left over
                </strong>
                <p className="plan-shelf-totals-hint">
                  {splitsIntoVolumes
                    ? `Rows over ${DEFAULT_PLAN_CAPACITY.toLocaleString()} cards split into volumes.`
                    : `Each binder holds ${DEFAULT_PLAN_CAPACITY.toLocaleString()} cards, 9 to a page.`}
                </p>
                {binders.length > 0 && (
                  <p className="plan-shelf-totals-hint">
                    Your {binders.length.toLocaleString()} existing{' '}
                    {binders.length === 1 ? 'binder stays' : 'binders stay'} in front of these.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="modal-footer">
        {noCollection ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" to="/collection" onClick={onClose}>
              Import your collection
            </Button>
          </>
        ) : allFiled ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || binderCount === 0}
            >
              {creating ? 'Creating…' : `Create ${plural(binderCount, 'binder', 'binders')}`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

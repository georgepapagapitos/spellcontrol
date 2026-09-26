import { useCallback, useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  Camera,
  Check,
  CheckSquare,
  Clock,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '../types';
import { Modal } from './Modal';
import { OverflowMenu } from './OverflowMenu';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { SegmentedControl } from './shared/form';
import { Button, IconButton } from './shared/Button';
import { conditionLabel, conditionShort } from './shared/CardRow';
import { useSearchCards } from '../lib/use-search-cards';
import { useConfirm } from '../lib/use-confirm';
import { formatMoney } from '../lib/format-money';
import { formatRelativeTime } from '../lib/format-time';
import { CONDITIONS, FINISH_LABELS, finishUnitPrice } from '../lib/scanner-feedback';
import type { ScannedEntry } from '../lib/use-scan-queue';

/** Every scanner sheet sits over the full-screen camera, which is above the
 *  modal tier: `--over-sheet` lifts the backdrop past it. A bottom sheet on a
 *  phone, a centred dialog on anything wider. */
export const SCANNER_SHEET_BACKDROP = 'modal-backdrop--sheet modal-backdrop--over-sheet';

interface Props {
  entries: ScannedEntry[];
  onClose: () => void;
  /** Open the edit sheet for one row. The parent owns it so the camera's
   *  last-scan panel can open the same sheet. */
  onEdit: (entryId: string) => void;
  onRemove: (ids: string[]) => void;
  onClearAll: () => void;
  onChangeFinish: (ids: string[], finish: Finish) => void;
  onChangeCondition: (ids: string[], condition: Condition) => void;
  /** Add a card found by name. Goes through the same list as a scan. */
  onAddCard: (card: ScryfallCard) => void;
  /** Add rows to the collection: the given ids, or every row when omitted. */
  onConfirm: (ids?: string[]) => void;
}

type Mode = 'list' | 'search' | 'select';
type Sort = 'newest' | 'price';

function unitPrice(e: ScannedEntry): number | null {
  return finishUnitPrice(e.card.prices, e.finish);
}

const countLabel = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

/**
 * The scanned-cards list: a bottom sheet over the camera, like ManaBox's.
 *
 * Built for both ways of scanning. A booster box wants a list you can glance
 * down: newest first, identical cards stacked into one row (3×), each row big
 * enough to check the art. A few cards from the mail want a quick way into
 * each one: tap a row to edit it. Everything rare (select, sort, clear) sits
 * in the ⋮ menu, and "Clear the list" goes last in red behind a confirm
 * instead of standing in the footer.
 */
export function ScannerQueueSheet({
  entries,
  onClose,
  onEdit,
  onRemove,
  onClearAll,
  onChangeFinish,
  onChangeCondition,
  onAddCard,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>('list');
  const [sort, setSort] = useState<Sort>('newest');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const totalCount = entries.reduce((sum, e) => sum + e.qty, 0);
  const totalPrice = entries.reduce((sum, e) => sum + (unitPrice(e) ?? 0) * e.qty, 0);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = q
      ? entries.filter(
          (e) => e.card.name.toLowerCase().includes(q) || e.card.set_name.toLowerCase().includes(q)
        )
      : entries;
    return [...shown].sort((a, b) =>
      sort === 'price'
        ? (unitPrice(b) ?? -1) - (unitPrice(a) ?? -1)
        : (b.addedAt ?? 0) - (a.addedAt ?? 0)
    );
  }, [entries, filter, sort]);

  // Rows can merge or disappear under a selection (a bulk finish change
  // re-keys them), so only ids still in the list count as selected.
  const selectedIds = entries.filter((e) => selected.has(e.id)).map((e) => e.id);
  const selectedCount = entries.filter((e) => selected.has(e.id)).reduce((n, e) => n + e.qty, 0);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const leaveSelect = () => {
    setMode('list');
    setSelected(new Set());
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: `Clear ${countLabel(totalCount)}?`,
      body: "They haven't been added to your collection yet, so this removes them for good.",
      confirmLabel: 'Clear',
      cancelLabel: 'Keep them',
      danger: true,
      backdropClassName: 'modal-backdrop--over-sheet',
    });
    if (ok) onClearAll();
  };

  const removeSelected = async () => {
    const ok = await confirm({
      title: `Remove ${countLabel(selectedCount)}?`,
      body: "They haven't been added to your collection yet, so this removes them for good.",
      confirmLabel: 'Remove',
      cancelLabel: 'Keep them',
      danger: true,
      backdropClassName: 'modal-backdrop--over-sheet',
    });
    if (!ok) return;
    onRemove(selectedIds);
    leaveSelect();
  };

  const title =
    mode === 'select'
      ? `${countLabel(selectedCount)} selected`
      : totalCount > 0
        ? `${countLabel(totalCount)} scanned`
        : 'Scanned cards';

  return (
    <Modal
      onClose={onClose}
      className="modal scanner-list-sheet"
      backdropClassName={SCANNER_SHEET_BACKDROP}
      labelledBy="scanner-list-title"
    >
      <div className="modal-header scanner-sheet-head">
        <div className="scanner-sheet-heading">
          <h2 id="scanner-list-title">{title}</h2>
          {mode !== 'select' && totalCount > 0 && (
            <span className="scanner-sheet-sub">{formatMoney(totalPrice)} total</span>
          )}
          {mode === 'select' && <span className="scanner-sheet-sub">Tap cards to select them</span>}
        </div>
        {mode === 'select' ? (
          <Button onClick={leaveSelect}>Done</Button>
        ) : (
          <>
            {totalCount > 0 && (
              <OverflowMenu
                ariaLabel="More list actions"
                items={[
                  { label: 'Select cards', icon: ListChecks, onClick: () => setMode('select') },
                  sort === 'newest'
                    ? {
                        label: 'Sort by price',
                        icon: ArrowDownWideNarrow,
                        onClick: () => setSort('price'),
                      }
                    : { label: 'Sort by newest', icon: Clock, onClick: () => setSort('newest') },
                  {
                    label: 'Clear the list',
                    icon: Trash2,
                    danger: true,
                    onClick: () => void clearAll(),
                  },
                ]}
              />
            )}
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </>
        )}
      </div>

      {mode === 'search' ? (
        <AddByName onAddCard={onAddCard} onDone={() => setMode('list')} />
      ) : (
        <>
          {mode === 'list' && totalCount > 0 && (
            <div className="scanner-sheet-tools">
              <SearchPill
                className="scanner-sheet-filter"
                inputType="text"
                placeholder="Filter cards"
                value={filter}
                onChange={setFilter}
                ariaLabel="Filter scanned cards"
              />
              <Button
                icon={<Plus width={14} height={14} strokeWidth={2} />}
                onClick={() => setMode('search')}
              >
                Add by name
              </Button>
            </div>
          )}

          <div className="modal-body scanner-sheet-body">
            {totalCount === 0 ? (
              <div className="scanner-sheet-empty">
                <Camera width={32} height={32} strokeWidth={1.6} aria-hidden />
                <p className="scanner-sheet-empty-title">No cards scanned yet</p>
                <p className="scanner-sheet-empty-hint">
                  Point the camera at a card. Each one you scan lands here.
                </p>
                <Button
                  icon={<Plus width={14} height={14} strokeWidth={2} />}
                  onClick={() => setMode('search')}
                >
                  Add by name
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <p className="scanner-sheet-none">No scanned cards match “{filter.trim()}”.</p>
            ) : (
              <ul className="scan-rows">
                {rows.map((e) => (
                  <ScanRow
                    key={e.id}
                    entry={e}
                    selecting={mode === 'select'}
                    selected={selected.has(e.id)}
                    onToggle={() => toggle(e.id)}
                    onEdit={() => onEdit(e.id)}
                    onRemove={() => onRemove([e.id])}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="modal-footer scanner-sheet-foot">
            {mode === 'select' ? (
              <>
                <Button
                  className="scanner-danger-btn"
                  icon={<Trash2 width={14} height={14} strokeWidth={1.8} />}
                  disabled={selectedIds.length === 0}
                  onClick={() => void removeSelected()}
                >
                  Remove
                </Button>
                <Button
                  icon={<Pencil width={14} height={14} strokeWidth={1.8} />}
                  disabled={selectedIds.length === 0}
                  onClick={() => setBulkEditOpen(true)}
                >
                  Edit
                </Button>
                <Button
                  variant="primary"
                  className="scanner-sheet-add"
                  icon={<Plus width={14} height={14} strokeWidth={2} />}
                  disabled={selectedIds.length === 0}
                  onClick={() => onConfirm(selectedIds)}
                >
                  Add {countLabel(selectedCount)}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onClose}>Keep scanning</Button>
                <Button
                  variant="primary"
                  className="scanner-sheet-add"
                  icon={<Plus width={14} height={14} strokeWidth={2} />}
                  disabled={totalCount === 0}
                  onClick={() => onConfirm()}
                >
                  {totalCount > 0 ? `Add ${countLabel(totalCount)}` : 'Add cards'}
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {bulkEditOpen && (
        <BulkEdit
          count={selectedCount}
          onFinish={(f) => onChangeFinish(selectedIds, f)}
          onCondition={(c) => onChangeCondition(selectedIds, c)}
          onClose={() => setBulkEditOpen(false)}
        />
      )}
      {confirmDialog}
    </Modal>
  );
}

function ScanRow({
  entry,
  selecting,
  selected,
  onToggle,
  onEdit,
  onRemove,
}: {
  entry: ScannedEntry;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { card } = entry;
  const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
  const unit = unitPrice(entry);
  const condition = entry.condition ?? 'nm';
  const body = (
    <>
      <span className="scan-row-thumb">
        {img ? <img src={img} alt="" loading="lazy" /> : <span>{card.name}</span>}
        {selecting && (
          <span className={`scan-row-check${selected ? ' is-on' : ''}`} aria-hidden>
            {selected && <Check width={16} height={16} strokeWidth={3} />}
          </span>
        )}
      </span>
      <span className="scan-row-body">
        <span className="scan-row-name">
          <span className="scan-row-qty">{entry.qty}×</span> {card.name}
        </span>
        <span className="scan-row-meta">
          {card.set_name} · #{card.collector_number ?? '—'}
        </span>
        <span className="scan-row-tags">
          <span className={`scan-row-tag finish-${entry.finish}`}>
            {FINISH_LABELS[entry.finish]}
          </span>
          <span className="scan-row-tag" title={conditionLabel(condition)}>
            {conditionShort(condition)}
          </span>
        </span>
        {entry.addedAt ? (
          <span className="scan-row-meta">{capitalize(formatRelativeTime(entry.addedAt))}</span>
        ) : null}
      </span>
      <span className="scan-row-price">{unit != null ? formatMoney(unit * entry.qty) : '—'}</span>
    </>
  );

  if (selecting) {
    // Picking rows out of a list is a checkbox's job (STYLE_GUIDE § Config
    // surfaces). The whole row is its label.
    return (
      <li className={`scan-row${selected ? ' is-selected' : ''}`}>
        <label className="scan-row-main">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="scan-row-input"
          />
          {body}
        </label>
      </li>
    );
  }

  return (
    <li className="scan-row">
      <button
        type="button"
        className="scan-row-main"
        onClick={onEdit}
        aria-label={`Edit ${entry.qty} ${card.name}, ${card.set_name}`}
      >
        {body}
        <Pencil className="scan-row-pencil" width={16} height={16} strokeWidth={1.8} aria-hidden />
      </button>
      <IconButton
        className="scan-row-remove"
        label={`Remove ${card.name}`}
        title={false}
        icon={<Trash2 width={17} height={17} strokeWidth={1.8} />}
        onClick={onRemove}
      />
    </li>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** For a card the camera won't read: search every card by name, tap to add.
 *  Replaces the list while it's open, then Done goes back. */
function AddByName({
  onAddCard,
  onDone,
}: {
  onAddCard: (card: ScryfallCard) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  // Printing ids added while the search is open: flips the row's + to a ✓ so
  // the tap registers without the results reshuffling.
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const { results, loading, error } = useSearchCards(query, 40);
  const searching = query.trim().length >= 2;

  return (
    <>
      <div className="scanner-sheet-tools">
        {/* inputType="text", not "search": Android paints a native search
            field with an opaque background that ignores author styles. */}
        <SearchPill
          className="scanner-sheet-filter"
          inputType="text"
          placeholder="Search all cards"
          value={query}
          onChange={setQuery}
          ariaLabel="Search all cards to add one"
          inputProps={{
            autoFocus: true,
            inputMode: 'search',
            enterKeyHint: 'search',
            autoCapitalize: 'none',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
      </div>
      <div className="modal-body scanner-sheet-body">
        {!searching ? (
          <p className="scanner-sheet-none">Type a card name to find it.</p>
        ) : loading && results.length === 0 ? (
          <p className="scanner-sheet-none">Searching…</p>
        ) : error ? (
          <p className="scanner-sheet-none" role="alert">
            {error}
          </p>
        ) : results.length === 0 ? (
          <p className="scanner-sheet-none">No cards match “{query.trim()}”.</p>
        ) : (
          <ul className="scan-results">
            {results.map((c) => {
              const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
              const isAdded = added.has(c.id);
              const usd = c.prices?.usd ? formatMoney(Number.parseFloat(c.prices.usd)) : null;
              return (
                <li key={c.id} className="scan-result">
                  <span className="scan-result-thumb">
                    {img ? <img src={img} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="scan-result-body">
                    <span className="scan-row-name">{c.name}</span>
                    <span className="scan-row-meta">
                      {c.set_name} · #{c.collector_number ?? '—'}
                    </span>
                  </span>
                  {usd && <span className="scan-result-price">{usd}</span>}
                  <Button
                    className={isAdded ? 'scan-result-add is-added' : 'scan-result-add'}
                    icon={
                      isAdded ? (
                        <Check width={14} height={14} strokeWidth={2.5} />
                      ) : (
                        <Plus width={14} height={14} strokeWidth={2} />
                      )
                    }
                    onClick={() => {
                      onAddCard(c);
                      setAdded((prev) => new Set(prev).add(c.id));
                    }}
                    aria-label={`Add ${c.name}, ${c.set_name}`}
                  >
                    {isAdded ? 'Added' : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="modal-footer scanner-sheet-foot">
        <Button variant="primary" className="scanner-sheet-add" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}

/** Edit several rows at once from select mode. Each tap applies at once;
 *  there's nothing to save. Finish clamps per card to what its printing has. */
function BulkEdit({
  count,
  onFinish,
  onCondition,
  onClose,
}: {
  count: number;
  onFinish: (finish: Finish) => void;
  onCondition: (condition: Condition) => void;
  onClose: () => void;
}) {
  const [finish, setFinish] = useState<Finish | ''>('');
  const [condition, setCondition] = useState<Condition | ''>('');
  return (
    <Modal
      onClose={onClose}
      className="modal scanner-edit-sheet"
      backdropClassName={SCANNER_SHEET_BACKDROP}
      labelledBy="scanner-bulk-title"
    >
      <div className="modal-header scanner-sheet-head">
        <div className="scanner-sheet-heading">
          <h2 id="scanner-bulk-title">Edit {countLabel(count)}</h2>
          <span className="scanner-sheet-sub">Changes apply to every selected card</span>
        </div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body scanner-edit-body">
        <div className="scanner-edit-field">
          <span className="form-field-label">Finish</span>
          <SegmentedControl<Finish | ''>
            ariaLabel="Finish for the selected cards"
            value={finish}
            options={[
              { value: 'nonfoil', label: 'Normal' },
              { value: 'foil', label: 'Foil' },
            ]}
            onChange={(f) => {
              if (!f) return;
              setFinish(f);
              onFinish(f);
            }}
          />
          <p className="form-field-hint">A card with no foil printing stays Normal.</p>
        </div>
        <div className="scanner-edit-field">
          <span className="form-field-label">Condition</span>
          <SelectMenu<string>
            ariaLabel="Condition for the selected cards"
            value={condition}
            placeholder="Choose a condition"
            options={CONDITIONS.map((c) => ({ value: c, label: conditionLabel(c) }))}
            onChange={(c) => {
              setCondition(c as Condition);
              onCondition(c as Condition);
            }}
          />
        </div>
      </div>
      <div className="modal-footer scanner-sheet-foot">
        <Button
          variant="primary"
          className="scanner-sheet-add"
          icon={<CheckSquare width={14} height={14} strokeWidth={1.8} />}
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </Modal>
  );
}

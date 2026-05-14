import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { importFile, importText } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import {
  SORT_FIELDS,
  NEW_BINDER_DEFAULT_SORTS,
  MAX_SORTS,
  getImplicitTiebreakers,
  sortEntryLabel,
  describeSortOrder,
  CUSTOMIZABLE_VALUE_ORDER_FIELDS,
} from '../lib/sorting';
import { SortValueOrderEditor } from './SortValueOrderEditor';
import { areAllGroupsEmpty, cardMatchesCompiled, compileFilterGroups } from '../lib/rules';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { SelectMenu } from './SelectMenu';
import { SortDirArrow } from './SortDirArrow';
import { ColorPicker } from './ColorPicker';
import { PRESET_COLORS, pickRandomPresetColor } from '../lib/preset-colors';
import type {
  BinderFilter,
  BinderFilterGroup,
  BinderInput,
  BorderColor,
  ColorChoice,
  EnrichedCard,
  Finish,
  Format,
  Layout,
  NegatableChip,
  PocketSize,
  Rarity,
  SortEntry,
  SortField,
  Treatment,
} from '../types';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const COLORS: { key: ColorChoice; label: string }[] = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'M', label: 'Multicolor' },
  { key: 'C', label: 'Colorless' },
];
const FORMATS: Format[] = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'commander',
  'pauper',
];
const FINISHES: { key: Finish; label: string }[] = [
  { key: 'nonfoil', label: 'Normal' },
  { key: 'foil', label: 'Foil' },
  { key: 'etched', label: 'Etched' },
];
const LAYOUTS: { key: Layout; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'split', label: 'Split' },
  { key: 'flip', label: 'Flip' },
  { key: 'transform', label: 'Transform' },
  { key: 'modal_dfc', label: 'Modal DFC' },
  { key: 'adventure', label: 'Adventure' },
  { key: 'meld', label: 'Meld' },
  { key: 'leveler', label: 'Leveler' },
  { key: 'saga', label: 'Saga' },
  { key: 'planar', label: 'Planar' },
  { key: 'scheme', label: 'Scheme' },
  { key: 'vanguard', label: 'Vanguard' },
  { key: 'token', label: 'Token' },
  { key: 'double_faced_token', label: 'DFC token' },
  { key: 'emblem', label: 'Emblem' },
  { key: 'augment', label: 'Augment' },
  { key: 'host', label: 'Host' },
  { key: 'class', label: 'Class' },
];
const TREATMENT_OPTIONS: { key: Treatment; label: string }[] = [
  { key: 'fullart', label: 'Full art' },
  { key: 'extendedart', label: 'Extended art' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'etched', label: 'Etched' },
  { key: 'inverted', label: 'Inverted' },
];
const BORDER_OPTIONS: { key: BorderColor; label: string }[] = [
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'borderless', label: 'Borderless' },
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
];
const DEFAULT_EDHREC_TOP_N = 100;

const EMPTY_FILTER: BinderFilter = {};
const newGroup = (): BinderFilterGroup => ({ filter: {} });

export function BinderEditor() {
  const editingBinder = useCollectionStore((s) => s.editingBinder);
  const binders = useCollectionStore((s) => s.binders);
  const cards = useCollectionStore((s) => s.cards);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const createBinder = useCollectionStore((s) => s.createBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const importCards = useCollectionStore((s) => s.importCards);
  const setLoading = useCollectionStore((s) => s.setLoading);

  const isOpen = editingBinder !== null;
  const isNew = editingBinder === 'new';
  const existing = !isNew ? binders.find((b) => b.id === editingBinder) : undefined;

  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0].hex);
  // Pre-compute the random color for the next "new binder" open. Kept in state
  // (not a ref) so it can be safely read during the render-phase reset; updated
  // via a macrotask so Math.random() is never called during render.
  const [nextRandomColor, setNextRandomColor] = useState(PRESET_COLORS[0].hex);
  const [pocketSize, setPocketSize] = useState<PocketSize>(9);
  const [doubleSided, setDoubleSided] = useState(false);
  const [fixedCapacity, setFixedCapacity] = useState<number | null>(null);
  const [showDeckAllocated, setShowDeckAllocated] = useState(true);
  const [groups, setGroups] = useState<BinderFilterGroup[]>([newGroup()]);
  const [routingMode, setRoutingMode] = useState<'rules' | 'manual'>('rules');
  const [sorts, setSorts] = useState<SortEntry[]>([...NEW_BINDER_DEFAULT_SORTS]);
  const [sortValueOrders, setSortValueOrders] = useState<Partial<Record<SortField, string[]>>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState('');
  // After adding a group, set this to the new index so the group's name input can autofocus.
  const [autofocusGroupIdx, setAutofocusGroupIdx] = useState<number | null>(null);
  const [binderMode, setBinderMode] = useState<'rules' | 'import'>('rules');
  const [importPasteText, setImportPasteText] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importFile_, setImportFile] = useState<File | null>(null);

  // Set codes the user actually owns — used to populate the multi-select.
  const ownedSets = useMemo(() => {
    const map = new Map<string, string>(); // code → name
    for (const c of cards) {
      const code = c.setCode.toUpperCase();
      if (!map.has(code)) map.set(code, c.setName || code);
    }
    return Array.from(map.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  // Autocomplete suggestions for type-line and oracle-text chips.
  // Scryfall catalog data is fetched once and merged with tokens from the collection.
  const [typeSuggestions, setTypeSuggestions] = useState<string[]>([]);
  const [oracleSuggestions, setOracleSuggestions] = useState<string[]>([]);

  useEffect(() => {
    // Derive type tokens from the collection while the catalog fetch is in flight.
    const collectionTokens = new Set<string>();
    for (const c of cards) {
      if (!c.typeLine) continue;
      for (const tok of c.typeLine.split(/[\s——]+/)) {
        const t = tok.trim();
        if (t) collectionTokens.add(t);
      }
    }

    fetchTypeSuggestions().then((catalog) => {
      const merged = [...new Set([...catalog, ...collectionTokens])].sort((a, b) =>
        a.localeCompare(b)
      );
      setTypeSuggestions(merged);
    });

    fetchOracleSuggestions().then((catalog) => {
      setOracleSuggestions(catalog);
    });
    // Only re-run when the editor opens (isOpen), not on every card change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Sync form fields from props when the modal opens. Use the render-phase reset
  // pattern: track the last `isOpen`/`existing` pair we initialized for, and
  // re-init whenever either changes while the modal is open.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevExisting, setPrevExisting] = useState(existing);
  if (prevIsOpen !== isOpen || prevExisting !== existing) {
    setPrevIsOpen(isOpen);
    setPrevExisting(existing);
    if (isOpen) {
      if (existing) {
        setName(existing.name);
        setColor(existing.color);
        setPocketSize(existing.pocketSize ?? 9);
        setDoubleSided(!!existing.doubleSided);
        setFixedCapacity(existing.fixedCapacity ?? null);
        setShowDeckAllocated(existing.hideDeckAllocated !== false);
        const existingGroups = existing.filterGroups?.length
          ? existing.filterGroups.map((g) => ({
              name: g.name,
              filter: { ...(g.filter ?? EMPTY_FILTER) },
            }))
          : [newGroup()];
        setGroups(existingGroups);
        setRoutingMode(existing.mode ?? 'rules');
        setSorts([...existing.sorts]);
        setSortValueOrders({ ...(existing.sortValueOrders ?? {}) });
      } else {
        setName('');
        setColor(nextRandomColor);
        setPocketSize(9);
        setDoubleSided(false);
        setFixedCapacity(null);
        setShowDeckAllocated(true);
        setGroups([newGroup()]);
        setRoutingMode('rules');
        setSorts([...NEW_BINDER_DEFAULT_SORTS]);
        setSortValueOrders({});
      }
      setErrorMsg(null);
      setLiveMsg('');
      setAutofocusGroupIdx(null);
      setBinderMode('rules');
      setImportPasteText('');
      setImportFile(null);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => setNextRandomColor(pickRandomPresetColor()), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  useLockBodyScroll(isOpen);

  const binderMatchCount = useMemo(() => {
    if (fixedCapacity === null) return 0;
    const compiled = compileFilterGroups(groups);
    let n = 0;
    for (const card of cards) {
      for (let i = 0; i < compiled.length; i++) {
        if (cardMatchesCompiled(card, compiled[i])) {
          n++;
          break;
        }
      }
    }
    return n;
  }, [cards, groups, fixedCapacity]);

  if (!isOpen) return null;

  const updateGroup = (idx: number, patch: (g: BinderFilterGroup) => BinderFilterGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? patch(g) : g)));

  const patchFilter = (idx: number, p: Partial<BinderFilter>) =>
    updateGroup(idx, (g) => ({ ...g, filter: { ...g.filter, ...p } }));

  const setGroupName = (idx: number, name: string) => updateGroup(idx, (g) => ({ ...g, name }));

  const addGroup = () => {
    setGroups((prev) => {
      const next = [...prev, newGroup()];
      setAutofocusGroupIdx(next.length - 1);
      setLiveMsg(`Rule group ${next.length} added`);
      return next;
    });
  };

  const duplicateGroup = (idx: number) => {
    setGroups((prev) => {
      const src = prev[idx];
      const copy: BinderFilterGroup = {
        name: src.name ? `${src.name} (copy)` : undefined,
        filter: { ...src.filter, ...cloneChips(src.filter) },
      };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      setAutofocusGroupIdx(idx + 1);
      setLiveMsg(`Rule group ${idx + 2} added (duplicated)`);
      return next;
    });
  };

  const removeGroup = (idx: number) => {
    setGroups((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setLiveMsg(`Rule group ${idx + 1} removed`);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMsg('Name is required');
      return;
    }
    if (binderMode === 'import' && isNew && !importPasteText.trim() && !importFile_) {
      setErrorMsg('Paste a card list or upload a CSV');
      return;
    }
    for (let i = 0; i < groups.length; i++) {
      const rangeError = validateRanges(groups[i].filter);
      if (rangeError) {
        const label = groups[i].name?.trim() || `group ${i + 1}`;
        setErrorMsg(`${rangeError} (${label})`);
        return;
      }
    }

    const cleanedGroups: BinderFilterGroup[] = groups.map((g) => ({
      ...(g.name?.trim() ? { name: g.name.trim() } : {}),
      filter: cleanFilter(g.filter),
    }));
    const input: BinderInput = {
      name: name.trim(),
      position: existing?.position ?? 0,
      filterGroups: cleanedGroups,
      sorts,
      pocketSize,
      doubleSided,
      fixedCapacity,
      color,
      mode: routingMode,
      hideDeckAllocated: showDeckAllocated ? undefined : false,
      sortValueOrders: Object.keys(sortValueOrders).length ? sortValueOrders : undefined,
    };

    setSaving(true);
    setErrorMsg(null);
    try {
      if (existing) {
        updateBinder(existing.id, input);
      } else {
        createBinder(input);

        const hasImport = importPasteText.trim() || importFile_;
        if (hasImport) {
          setLoading(true);
          try {
            const result = importFile_
              ? await importFile(importFile_)
              : await importText(importPasteText.trim());
            const label = importFile_ ? importFile_.name : 'pasted-list';
            await importCards(result, label, 'binder', { binderName: name.trim() });
          } finally {
            setLoading(false);
          }
        }
      }
      setEditingBinder(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const showEmptyWarning = areAllGroupsEmpty(groups);
  const capacity = fixedCapacity ?? 0;
  // Suppress over-capacity warning when filters are empty — an unfiltered binder
  // would match every card by definition, which is never what the warning is
  // trying to flag.
  const overCapacity = fixedCapacity !== null && !showEmptyWarning && binderMatchCount > capacity;

  return (
    <div className="modal-backdrop" onClick={() => setEditingBinder(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{existing ? 'Edit binder' : 'New binder'}</h2>
          <button className="modal-close" onClick={() => setEditingBinder(null)} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Basics */}
          <section className="editor-section">
            <div className="editor-row">
              <div className="field" style={{ flex: 1, minWidth: 0 }}>
                <label>Binder name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Standard staples, Cube reserves..."
                  autoFocus
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="editor-row" style={{ alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Pocket layout</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <SelectMenu
                    ariaLabel="Pocket layout"
                    value={pocketSize}
                    onChange={(v) => setPocketSize(v as PocketSize)}
                    options={[
                      { value: 4, label: '4-pocket' },
                      { value: 9, label: '9-pocket' },
                      { value: 12, label: '12-pocket' },
                    ]}
                  />
                  <label
                    className="field-checkbox"
                    style={{ margin: 0, whiteSpace: 'nowrap' }}
                    title="Each sheet stores cards on both sides — back of each sheet counts as its own page."
                  >
                    <input
                      type="checkbox"
                      checked={doubleSided}
                      onChange={(e) => setDoubleSided(e.target.checked)}
                    />
                    Double-sided
                  </label>
                </div>
              </div>
            </div>
            <div className="editor-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Capacity</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <label className="field-checkbox" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={fixedCapacity !== null}
                      onChange={(e) =>
                        setFixedCapacity(
                          e.target.checked ? pocketSize * (doubleSided ? 40 : 20) : null
                        )
                      }
                    />
                    Fixed
                  </label>
                  {fixedCapacity !== null && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        step={1}
                        value={fixedCapacity}
                        onChange={(e) => {
                          const cards = parseInt(e.target.value);
                          setFixedCapacity(Number.isFinite(cards) && cards > 0 ? cards : 1);
                        }}
                        aria-label="Capacity in cards"
                        style={{ width: 100 }}
                      />
                      <span style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>
                        cards · ≈{' '}
                        <strong>{Math.ceil(fixedCapacity / pocketSize).toLocaleString()}</strong>{' '}
                        {Math.ceil(fixedCapacity / pocketSize) === 1 ? 'page' : 'pages'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {overCapacity && (
              <div className="warn-banner" style={{ marginTop: '0.5rem' }}>
                ⚠️ This binder matches {binderMatchCount.toLocaleString()} cards but its capacity is
                only {capacity.toLocaleString()}. The extra{' '}
                {(binderMatchCount - capacity).toLocaleString()} won't fit physically — they'll
                still display, just flagged as over-capacity.
              </div>
            )}
            <div className="editor-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Deck cards</label>
                <label
                  className="field-checkbox"
                  style={{ margin: 0 }}
                  title="When off, cards currently allocated to any deck are hidden from this binder until the deck releases them. Pins and manual order are preserved."
                >
                  <input
                    type="checkbox"
                    checked={showDeckAllocated}
                    onChange={(e) => setShowDeckAllocated(e.target.checked)}
                  />
                  Show cards that are in a deck
                </label>
              </div>
            </div>
            <div className="editor-row">
              <div className="field">
                <label>Tab color</label>
                <ColorPicker value={color} onChange={setColor} ariaLabel="Tab color" />
              </div>
            </div>
          </section>

          {isNew && (
            <div className="binder-mode-toggle" role="radiogroup" aria-label="Binder creation mode">
              <button
                type="button"
                role="radio"
                aria-checked={binderMode === 'rules'}
                className={`binder-mode-pill${binderMode === 'rules' ? ' active' : ''}`}
                onClick={() => setBinderMode('rules')}
              >
                Build with rules
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={binderMode === 'import'}
                className={`binder-mode-pill${binderMode === 'import' ? ' active' : ''}`}
                onClick={() => setBinderMode('import')}
              >
                Import a list
              </button>
            </div>
          )}

          {(binderMode === 'rules' || existing) && (
            <>
              {/* Filters */}
              <section className="editor-section">
                {routingMode === 'manual' && existing && (
                  <div className="manual-mode-banner">
                    <p>
                      This binder uses manual mode. Only pinned cards appear; filter rules are
                      paused.
                    </p>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setRoutingMode('rules')}
                    >
                      Switch to rules
                    </button>
                  </div>
                )}

                <div
                  style={
                    routingMode === 'manual' ? { opacity: 0.5, pointerEvents: 'none' } : undefined
                  }
                >
                  <h3>
                    Filters{' '}
                    <span className="muted">
                      {groups.length === 1
                        ? '— a card joins this binder if it matches every filter below'
                        : '— a card joins this binder if it matches any rule group below'}
                    </span>
                  </h3>

                  <FilterGroupList
                    groups={groups}
                    cards={cards}
                    ownedSets={ownedSets}
                    typeSuggestions={typeSuggestions}
                    oracleSuggestions={oracleSuggestions}
                    autofocusIdx={autofocusGroupIdx}
                    clearAutofocus={() => setAutofocusGroupIdx(null)}
                    onPatchFilter={patchFilter}
                    onSetName={setGroupName}
                    onAdd={addGroup}
                    onDuplicate={duplicateGroup}
                    onRemove={removeGroup}
                  />
                </div>

                <div className="sr-only" role="status" aria-live="polite">
                  {liveMsg}
                </div>

                {showEmptyWarning && (
                  <div className="warn-banner" style={{ marginTop: '0.75rem' }}>
                    ⚠️ This binder has no filters — it will match every remaining card. Add at least
                    one, or place this binder near the bottom of the priority list.
                  </div>
                )}
              </section>

              {/* Sort */}
              <section className="editor-section">
                <h3>Sort within binder</h3>
                <p className="muted" style={{ marginBottom: '0.5rem' }}>
                  The first sort splits the binder into section headers; later sorts order cards
                  within each section. Up to {MAX_SORTS} rules — treatment, finish, and name are
                  applied automatically as tie-breakers after yours.
                </p>
                <div className="sort-editor-list">
                  {sorts.map((s, i) => {
                    const orderHint = describeSortOrder(s.field, s.dir, sortValueOrders);
                    const isCustomizable = CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(s.field);
                    return (
                      <div key={i} className="sort-editor-row">
                        <span className="sort-editor-num">{i + 1}.</span>
                        <SelectMenu
                          ariaLabel={`Sort ${i + 1} field`}
                          value={s.field}
                          options={SORT_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
                          closeOnSelect={false}
                          leadingIcon={<SortDirArrow dir={s.dir} />}
                          renderItemPrefix={(_opt, active) =>
                            active ? <SortDirArrow dir={s.dir} /> : null
                          }
                          onChange={(field) => {
                            setSorts(
                              sorts.map((x, j) => {
                                if (j !== i) return x;
                                if (x.field === field) {
                                  return { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' };
                                }
                                const defaultDir =
                                  SORT_FIELDS.find((f) => f.value === field)?.defaultDir ?? 'asc';
                                return { field: field as SortField, dir: defaultDir };
                              })
                            );
                          }}
                        />
                        <div className="tab-actions sort-editor-actions">
                          <button
                            type="button"
                            className="tab-action"
                            onClick={() => setSorts(swap(sorts, i, i - 1))}
                            disabled={i === 0}
                            title="Move up"
                            aria-label="Move sort up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="tab-action"
                            onClick={() => setSorts(swap(sorts, i, i + 1))}
                            disabled={i === sorts.length - 1}
                            title="Move down"
                            aria-label="Move sort down"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className="tab-action"
                            onClick={() => setSorts(sorts.filter((_, j) => j !== i))}
                            disabled={sorts.length === 1}
                            title="Remove this sort"
                            aria-label="Remove sort"
                          >
                            ×
                          </button>
                        </div>
                        {isCustomizable ? (
                          <SortValueOrderEditor
                            field={s.field}
                            value={sortValueOrders[s.field]}
                            onChange={(next) =>
                              setSortValueOrders((prev) => {
                                const copy = { ...prev };
                                if (next === undefined) delete copy[s.field];
                                else copy[s.field] = next;
                                return copy;
                              })
                            }
                          />
                        ) : (
                          orderHint && (
                            <p
                              className="muted sort-editor-order-hint"
                              style={{
                                width: '100%',
                                margin: '0.15rem 0 0 1.75rem',
                                fontSize: 'var(--text-xs)',
                              }}
                            >
                              {orderHint}
                            </p>
                          )
                        )}
                      </div>
                    );
                  })}
                  {sorts.length < MAX_SORTS && (
                    <button
                      type="button"
                      className="btn btn-add-group"
                      onClick={() => setSorts([...sorts, nextDefaultSort(sorts)])}
                    >
                      + Add sort
                    </button>
                  )}
                </div>
                <ImplicitTiebreakerHint sorts={sorts} valueOrders={sortValueOrders} />
              </section>
            </>
          )}

          {binderMode === 'import' && isNew && (
            <section className="editor-section">
              <p className="muted" style={{ marginBottom: '0.5rem' }}>
                Paste a card list or upload a CSV. Cards will be added to your collection and placed
                in this binder in the order listed.
              </p>
              {importFile_ ? (
                <div className="import-binder-file-row">
                  <span className="import-binder-file-name">{importFile_.name}</span>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setImportFile(null);
                      if (importFileRef.current) importFileRef.current.value = '';
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <textarea
                  className="paste-textarea import-binder-textarea"
                  value={importPasteText}
                  onChange={(e) => setImportPasteText(e.target.value)}
                  placeholder={'1 Llanowar Elves\n1 Birds of Paradise\n4 Lightning Bolt\n...'}
                  disabled={saving}
                  autoFocus
                />
              )}
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => importFileRef.current?.click()}
                  disabled={saving}
                >
                  Upload CSV
                </button>
                <input
                  type="file"
                  ref={importFileRef}
                  accept=".csv,.tsv,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setImportFile(file);
                      setImportPasteText('');
                    }
                    if (importFileRef.current) importFileRef.current.value = '';
                  }}
                  disabled={saving}
                />
              </div>
            </section>
          )}

          {errorMsg && <div className="error-banner">{errorMsg}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => setEditingBinder(null)} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving
              ? 'Saving...'
              : existing
                ? 'Save changes'
                : binderMode === 'import'
                  ? 'Create and import'
                  : 'Create binder'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── filter-group UI ─────────────────────────── */

/**
 * Renders the OR-list of filter groups. Each group is a `<fieldset>` whose
 * `<legend>` carries the optional name (acting as a heading for assistive tech)
 * and a remove button. An "OR" divider sits between groups (decorative;
 * meaning is in the fieldset semantics). A single "+ Add OR group" button
 * follows the list.
 */
function FilterGroupList({
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
}) {
  // Per-group match counts + deduped total. Single pass over cards: for each
  // card, check each compiled group; first hit increments `total`, every hit
  // increments that group's count. Compile is cached per render of this list.
  const { perGroup, total } = useMemo(() => {
    const compiled = compileFilterGroups(groups);
    const perGroup = new Array(compiled.length).fill(0) as number[];
    let total = 0;
    for (const card of cards) {
      let any = false;
      for (let i = 0; i < compiled.length; i++) {
        if (cardMatchesCompiled(card, compiled[i])) {
          perGroup[i]++;
          any = true;
        }
      }
      if (any) total++;
    }
    return { perGroup, total };
  }, [groups, cards]);

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
          />
          {i < groups.length - 1 && (
            <div className="filter-group-or" aria-hidden="true">
              <span>OR</span>
            </div>
          )}
        </div>
      ))}

      <div className="filter-group-footer">
        <button type="button" className="btn btn-add-group" onClick={onAdd}>
          + Add OR group
        </button>
        {groups.length > 1 && (
          <span className="filter-group-total" aria-live="polite">
            Matches <strong>{total.toLocaleString()}</strong> {total === 1 ? 'card' : 'cards'} total
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
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autofocus && nameRef.current) {
      nameRef.current.focus();
      onAutofocusHandled();
    }
  }, [autofocus, onAutofocusHandled]);

  const summary = autoSummary(group.filter);
  const fallback = `Rule group ${index + 1}`;
  const displayLabel = group.name?.trim() || summary || fallback;

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
      <FilterGroupFields
        filter={group.filter}
        onPatch={onPatchFilter}
        ownedSets={ownedSets}
        typeSuggestions={typeSuggestions}
        oracleSuggestions={oracleSuggestions}
      />
    </fieldset>
  );
}

/**
 * The 16 rule-rows that make up a single filter group. Pure presentation —
 * receives `filter` and a patch callback. `idPrefix` namespaces input ids so
 * multiple groups don't collide for assistive tech.
 */
function FilterGroupFields({
  filter,
  onPatch,
  ownedSets,
  typeSuggestions,
  oracleSuggestions,
}: {
  filter: BinderFilter;
  onPatch: (p: Partial<BinderFilter>) => void;
  ownedSets: { code: string; label: string }[];
  typeSuggestions: string[];
  oracleSuggestions: string[];
}) {
  const patch = onPatch;
  const edhrecEnabled = filter.edhrecRankMax !== undefined;
  return (
    <>
      {/* Legalities */}
      <div className="rule-row">
        <span className="rule-label">Legalities</span>
        <EnumChipBuilder
          options={FORMATS.map((f) => ({ value: f, label: f }))}
          chips={filter.legalities || []}
          onChange={(next) => patch({ legalities: next })}
          placeholder="Add format..."
        />
      </div>

      {/* Colors */}
      <div className="rule-row">
        <span className="rule-label">Color identity</span>
        <EnumChipBuilder
          options={COLORS.map((c) => ({ value: c.key, label: c.label }))}
          chips={filter.colors || []}
          onChange={(next) => patch({ colors: next })}
          placeholder="Add color..."
        />
      </div>

      {/* Rarity */}
      <div className="rule-row">
        <span className="rule-label">Rarity</span>
        <EnumChipBuilder
          options={RARITIES.map((r) => ({ value: r, label: r }))}
          chips={filter.rarities || []}
          onChange={(next) => patch({ rarities: next })}
          placeholder="Add rarity..."
        />
      </div>

      {/* CMC */}
      <div className="rule-row">
        <span className="rule-label">CMC</span>
        <NumberRangeInput
          min={filter.cmcMin}
          max={filter.cmcMax}
          step={1}
          onMinChange={(v) => patch({ cmcMin: v })}
          onMaxChange={(v) => patch({ cmcMax: v })}
        />
      </div>

      {/* Mana cost */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Exact mana cost match. Use Scryfall syntax with curly braces, e.g. {2}{G}{W} or {1}{R/W}. Leave blank to ignore."
        >
          Mana cost <span className="tooltip-marker">ⓘ</span>
        </span>
        <input
          type="text"
          value={filter.manaCost || ''}
          onChange={(e) => patch({ manaCost: e.target.value })}
          placeholder="{2}{G}{W}"
        />
      </div>

      {/* Type chips */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Substring match against the type line. Toggle each chip between IS and IS NOT. Example: IS Creature + IS NOT Legendary excludes legendary creatures."
        >
          Type line <span className="tooltip-marker">ⓘ</span>
        </span>
        <ChipBuilder
          chips={filter.typeChips || []}
          onChange={(next) => patch({ typeChips: next })}
          placeholder="e.g. creature, angel, legendary"
          suggestions={typeSuggestions}
        />
      </div>

      {/* Oracle text */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Substring match against the oracle (rules) text. Toggle each chip between IS and IS NOT."
        >
          Oracle text <span className="tooltip-marker">ⓘ</span>
        </span>
        <ChipBuilder
          chips={filter.oracleChips || []}
          onChange={(next) => patch({ oracleChips: next })}
          placeholder="e.g. flying, draw a card"
          suggestions={oracleSuggestions}
        />
      </div>

      {/* Sets */}
      <div className="rule-row">
        <span className="rule-label">Sets</span>
        <SetMultiSelect
          options={ownedSets}
          selected={filter.setCodes || []}
          onChange={(next) => patch({ setCodes: next })}
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

      {/* Finishes */}
      <div className="rule-row">
        <span className="rule-label">Finishes</span>
        <EnumChipBuilder
          options={FINISHES.map((f) => ({ value: f.key, label: f.label }))}
          chips={filter.finishes || []}
          onChange={(next) => patch({ finishes: next })}
          placeholder="Add finish..."
        />
      </div>

      {/* Layout */}
      <div className="rule-row">
        <span className="rule-label">Layout</span>
        <EnumChipBuilder
          options={LAYOUTS.map((l) => ({ value: l.key, label: l.label }))}
          chips={filter.layouts || []}
          onChange={(next) => patch({ layouts: next })}
          placeholder="Add layout..."
        />
      </div>

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

      {/* Treatments */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Cosmetic treatment of the printing. Full art = full-art lands and cards. Extended art = art that extends to the card edges. Showcase = special frame variants. Etched = etched-foil printings."
        >
          Treatment <span className="tooltip-marker">ⓘ</span>
        </span>
        <EnumChipBuilder
          options={TREATMENT_OPTIONS.map((t) => ({ value: t.key, label: t.label }))}
          chips={filter.treatments || []}
          onChange={(next) => patch({ treatments: next })}
          placeholder="Add treatment..."
        />
      </div>

      {/* Border */}
      <div className="rule-row">
        <span className="rule-label">Border</span>
        <EnumChipBuilder
          options={BORDER_OPTIONS.map((b) => ({ value: b.key, label: b.label }))}
          chips={filter.borderColors || []}
          onChange={(next) => patch({ borderColors: next })}
          placeholder="Add border..."
        />
      </div>

      {/* EDHREC */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="EDHREC tracks how often each card appears in EDH/Commander decks. Lower rank = more popular. Top 100 = roughly the most-played 100 cards across the format."
        >
          EDHREC popularity <span className="tooltip-marker">ⓘ</span>
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
          <span style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>most popular EDH cards</span>
        </div>
      </div>
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
  const chipNames = (chips: NegatableChip[] | undefined, max = 2) => {
    if (!chips || chips.length === 0) return null;
    const is = chips.filter((c) => !c.negate).map((c) => c.value);
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

  if (f.setCodes && f.setCodes.length > 0) {
    push(
      f.setCodes.length <= 2
        ? f.setCodes.join(', ')
        : `${f.setCodes.slice(0, 2).join(', ')} +${f.setCodes.length - 2}`
    );
  }

  if (f.priceMin !== undefined && f.priceMax !== undefined)
    parts.push(`$${f.priceMin}–${f.priceMax}`);
  else if (f.priceMin !== undefined) parts.push(`≥ $${f.priceMin}`);
  else if (f.priceMax !== undefined) parts.push(`≤ $${f.priceMax}`);

  if (f.cmcMin !== undefined && f.cmcMax !== undefined) parts.push(`CMC ${f.cmcMin}–${f.cmcMax}`);
  else if (f.cmcMin !== undefined) parts.push(`CMC ≥ ${f.cmcMin}`);
  else if (f.cmcMax !== undefined) parts.push(`CMC ≤ ${f.cmcMax}`);

  if (f.edhrecRankMax !== undefined) parts.push(`EDH top ${f.edhrecRankMax}`);
  if (f.manaCost?.trim()) parts.push(f.manaCost.trim());
  if (f.nameContains?.trim()) parts.push(`"${f.nameContains.trim()}"`);

  return parts.slice(0, 4).join(' · ');
}

/** Deep-clone the chip arrays of a filter (so duplication doesn't share mutable refs). */
function cloneChips(f: BinderFilter): Partial<BinderFilter> {
  const dup = (chips?: NegatableChip[]) => chips?.map((c) => ({ ...c }));
  return {
    legalities: dup(f.legalities),
    colors: dup(f.colors),
    rarities: dup(f.rarities),
    typeChips: dup(f.typeChips),
    oracleChips: dup(f.oracleChips),
    finishes: dup(f.finishes),
    layouts: dup(f.layouts),
    treatments: dup(f.treatments),
    borderColors: dup(f.borderColors),
    setCodes: f.setCodes ? [...f.setCodes] : undefined,
  };
}

/* ─────────────────────────── small components ─────────────────────────── */

/** ManaBox-style chip builder: type a value, hit Enter to add. Each chip toggles IS / IS NOT and has an X. */
const MAX_SUGGESTIONS = 8;

function ChipBuilder({
  chips,
  onChange,
  placeholder,
  suggestions = [],
}: {
  chips: NegatableChip[];
  onChange: (next: NegatableChip[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const taken = useMemo(() => new Set(chips.map((c) => c.value.toLowerCase())), [chips]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !taken.has(s.toLowerCase()))
      .slice(0, MAX_SUGGESTIONS);
  }, [draft, suggestions, taken]);

  const open = filtered.length > 0;

  const commit = useCallback(
    (value?: string) => {
      const v = (value ?? draft).trim();
      if (!v) return;
      if (chips.some((c) => c.value.toLowerCase() === v.toLowerCase())) {
        setDraft('');
        setActiveIdx(-1);
        return;
      }
      onChange([...chips, { value: v, negate: false }]);
      setDraft('');
      setActiveIdx(-1);
    },
    [draft, chips, onChange]
  );

  return (
    <div className="chip-builder-wrap">
      <div className="chip-builder-inner">
        {chips.map((c, i) => (
          <span
            key={i}
            className={`chip-builder-chip ${c.negate ? 'is-not' : 'is'}`}
            title="Click IS / IS NOT to toggle"
          >
            <button
              type="button"
              className="chip-builder-toggle"
              onClick={() =>
                onChange(chips.map((x, j) => (j === i ? { ...x, negate: !x.negate } : x)))
              }
            >
              {c.negate ? 'IS NOT' : 'IS'}
            </button>
            <span className="chip-builder-value">{c.value}</span>
            <button
              type="button"
              className="chip-builder-remove"
              aria-label="Remove"
              onClick={() => onChange(chips.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        <div className="chip-builder-input-wrap">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActiveIdx(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, -1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                commit(activeIdx >= 0 ? filtered[activeIdx] : undefined);
              } else if (e.key === 'Escape') {
                setDraft('');
                setActiveIdx(-1);
              } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
                onChange(chips.slice(0, -1));
              }
            }}
            onBlur={() => {
              // Delay so click on suggestion fires first
              setTimeout(() => {
                commit();
              }, 120);
            }}
            placeholder={placeholder}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-activedescendant={activeIdx >= 0 ? `chip-suggest-${activeIdx}` : undefined}
          />
          {open && (
            <ul ref={listRef} className="chip-suggest-list" role="listbox">
              {filtered.map((s, i) => (
                <li
                  key={s}
                  id={`chip-suggest-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`chip-suggest-item${i === activeIdx ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Dropdown-driven chip builder for controlled-vocabulary fields (e.g. rarity).
 * Picking from the dropdown adds an IS chip; click the IS / IS NOT pill to flip; X to remove.
 * Already-selected values disappear from the dropdown.
 */
function EnumChipBuilder({
  options,
  chips,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  chips: NegatableChip[];
  onChange: (next: NegatableChip[]) => void;
  placeholder?: string;
}) {
  const taken = new Set(chips.map((c) => c.value.toLowerCase()));
  const available = options.filter((o) => !taken.has(o.value.toLowerCase()));
  const labelFor = (val: string) =>
    options.find((o) => o.value.toLowerCase() === val.toLowerCase())?.label ?? val;

  return (
    <div className="chip-builder-wrap">
      {chips.map((c, i) => (
        <span
          key={i}
          className={`chip-builder-chip ${c.negate ? 'is-not' : 'is'}`}
          title="Click IS / IS NOT to toggle"
        >
          <button
            type="button"
            className="chip-builder-toggle"
            onClick={() =>
              onChange(chips.map((x, j) => (j === i ? { ...x, negate: !x.negate } : x)))
            }
          >
            {c.negate ? 'IS NOT' : 'IS'}
          </button>
          <span className="chip-builder-value">{labelFor(c.value)}</span>
          <button
            type="button"
            className="chip-builder-remove"
            aria-label="Remove"
            onClick={() => onChange(chips.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <SelectMenu
        value=""
        options={available.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => onChange([...chips, { value: v, negate: false }])}
        placeholder={available.length === 0 ? 'all added' : (placeholder ?? 'add...')}
        ariaLabel={placeholder ?? 'add'}
        disabled={available.length === 0}
      />
    </div>
  );
}

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
      <span style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>to</span>
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

function ImplicitTiebreakerHint({
  sorts,
  valueOrders,
}: {
  sorts: SortEntry[];
  valueOrders: Partial<Record<SortField, string[]>>;
}) {
  const extras = getImplicitTiebreakers(sorts);
  if (!extras.length) return null;
  const tooltipLines = [
    'Applied automatically after your sort rules to keep ordering stable.',
    'Add any of these to your chain above to flip direction or customize value order.',
    ...extras
      .map((e) => {
        const resolved = describeSortOrder(e.field, e.dir, valueOrders);
        return resolved ? `• ${sortEntryLabel(e)}: ${resolved}` : null;
      })
      .filter((s): s is string => s !== null),
  ];
  return (
    <p
      className="muted"
      style={{ marginTop: '0.5rem', fontSize: '0.85em' }}
      title={tooltipLines.join('\n')}
    >
      Then tie-broken by: {extras.map((e) => sortEntryLabel(e)).join(' → ')}
    </p>
  );
}

/** Swap two array elements; out-of-bounds indices return the array unchanged. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Pick a sort entry for a freshly-added row — the first field not already used, or 'name' as fallback. */
function nextDefaultSort(existing: SortEntry[]): SortEntry {
  for (const opt of SORT_FIELDS) {
    if (!existing.some((e) => e.field === opt.value)) {
      return { field: opt.value, dir: opt.defaultDir };
    }
  }
  return { field: 'name', dir: 'asc' };
}

function validateRanges(f: BinderFilter): string | null {
  if (f.priceMin !== undefined && f.priceMax !== undefined && f.priceMin > f.priceMax) {
    return 'Price minimum cannot exceed maximum';
  }
  if (f.cmcMin !== undefined && f.cmcMax !== undefined && f.cmcMin > f.cmcMax) {
    return 'CMC minimum cannot exceed maximum';
  }
  if (f.priceMin !== undefined && f.priceMin < 0) return 'Price cannot be negative';
  if (f.cmcMin !== undefined && f.cmcMin < 0) return 'CMC cannot be negative';
  if (f.edhrecRankMax !== undefined && f.edhrecRankMax < 1) {
    return 'EDHREC top N must be at least 1';
  }
  return null;
}

/** Strip empty strings/arrays/undefineds and chips with blank values. */
function cleanFilter(f: BinderFilter): BinderFilter {
  const out: BinderFilter = {};
  const cleanChips = (chips?: NegatableChip[]) => {
    const kept = (chips || [])
      .filter((c) => c.value.trim())
      .map((c) => ({ value: c.value.trim(), negate: c.negate }));
    return kept.length ? kept : undefined;
  };
  if (cleanChips(f.legalities)) out.legalities = cleanChips(f.legalities);
  if (cleanChips(f.colors)) out.colors = cleanChips(f.colors);
  if (cleanChips(f.rarities)) out.rarities = cleanChips(f.rarities);
  if (cleanChips(f.typeChips)) out.typeChips = cleanChips(f.typeChips);
  if (cleanChips(f.oracleChips)) out.oracleChips = cleanChips(f.oracleChips);
  if (cleanChips(f.finishes)) out.finishes = cleanChips(f.finishes);
  if (cleanChips(f.layouts)) out.layouts = cleanChips(f.layouts);
  if (cleanChips(f.treatments)) out.treatments = cleanChips(f.treatments);
  if (cleanChips(f.borderColors)) out.borderColors = cleanChips(f.borderColors);

  if (f.cmcMin !== undefined && !isNaN(f.cmcMin)) out.cmcMin = f.cmcMin;
  if (f.cmcMax !== undefined && !isNaN(f.cmcMax)) out.cmcMax = f.cmcMax;
  if (f.manaCost?.trim()) out.manaCost = f.manaCost.trim();
  if (f.setCodes && f.setCodes.length) out.setCodes = f.setCodes.map((s) => s.toUpperCase());
  if (f.priceMin !== undefined && !isNaN(f.priceMin)) out.priceMin = f.priceMin;
  if (f.priceMax !== undefined && !isNaN(f.priceMax)) out.priceMax = f.priceMax;
  if (f.nameContains?.trim()) out.nameContains = f.nameContains.trim();
  if (f.edhrecRankMax !== undefined && !isNaN(f.edhrecRankMax)) out.edhrecRankMax = f.edhrecRankMax;
  return out;
}

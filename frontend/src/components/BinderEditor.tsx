import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { importFile, importText } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { mergeStagedFiles, stagedFilesNotice, stripExtension } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { NEW_BINDER_DEFAULT_SORTS } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import { areAllGroupsEmpty, cardMatchesCompiled, compileFilterGroups } from '../lib/rules';
import { cleanFilter } from '../lib/clean-filter';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { SelectMenu } from './SelectMenu';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';
import { ColorPicker } from './ColorPicker';
import { PRESET_COLORS, pickRandomPresetColor } from '../lib/preset-colors';
import type {
  BinderFilter,
  BinderFilterGroup,
  BinderInput,
  BorderColor,
  ChipExpression,
  ColorChoice,
  EnrichedCard,
  Finish,
  Format,
  Layout,
  PocketSize,
  Rarity,
  SortEntry,
  SortField,
  Treatment,
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

// Default fixed capacity in cards for a given layout: 20 sheet-sides per page
// (40 when double-sided, since each sheet stores cards on both sides).
const defaultFixedCapacity = (pocket: PocketSize, doubleSided: boolean): number =>
  pocket * (doubleSided ? 40 : 20);

export function BinderEditor() {
  const editingBinder = useCollectionStore((s) => s.editingBinder);
  const binders = useCollectionStore((s) => s.binders);
  const cards = useCollectionStore((s) => s.cards);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const createBinder = useCollectionStore((s) => s.createBinder);
  const updateBinder = useCollectionStore((s) => s.updateBinder);
  const importCards = useCollectionStore((s) => s.importCards);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
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
  const [importFiles_, setImportFiles] = useState<File[]>([]);
  const [importStageNote, setImportStageNote] = useState<string | null>(null);
  // One draft binder per staged file. Each file becomes its own binder; the
  // user can rename it and recolor it before saving.
  const [binderDrafts, setBinderDrafts] = useState<Array<{ name: string; color: string }>>([]);
  // Set when staged files resolve to duplicate binder names and we need the
  // user to choose how to handle it (merge / rename / separate).
  const [collisionPrompt, setCollisionPrompt] = useState<
    { name: string; count: number; existing: boolean }[] | null
  >(null);

  /**
   * Keeps staged files and their per-file binder drafts aligned. Drafts are
   * matched by filename so edits survive add/remove (mergeStagedFiles already
   * guarantees unique names).
   */
  const applyStagedFiles = (nextFiles: File[], prevFiles: File[], note: string | null = null) => {
    const prevByName = new Map(prevFiles.map((f, i) => [f.name, binderDrafts[i]]));
    setImportFiles(nextFiles);
    setBinderDrafts(
      nextFiles.map(
        (f) =>
          prevByName.get(f.name) ?? { name: stripExtension(f.name), color: pickRandomPresetColor() }
      )
    );
    setImportStageNote(note);
    if (nextFiles.length > 0) setImportPasteText('');
  };

  /** Merges incoming files (picker or drop) into the staged list. */
  const stageIncoming = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { files, renamed, dropped } = mergeStagedFiles(importFiles_, incoming);
    applyStagedFiles(files, importFiles_, stagedFilesNotice(renamed, dropped));
  };

  const { isDragging: importDragging, dropProps: importDropProps } = useFileDrop(stageIncoming, {
    disabled: saving,
  });

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
      setImportFiles([]);
      setBinderDrafts([]);
      setImportStageNote(null);
      setCollisionPrompt(null);
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

  /** Effective binder name for a staged file (draft name, or filename). */
  const draftName = (i: number) =>
    binderDrafts[i]?.name.trim() || stripExtension(importFiles_[i].name);

  /** Staged file indices grouped by case-insensitive effective name. */
  const groupIndicesByName = (): number[][] => {
    const order: string[] = [];
    const map = new Map<string, number[]>();
    importFiles_.forEach((_, i) => {
      const key = draftName(i).toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(i);
    });
    return order.map((k) => map.get(k)!);
  };

  /**
   * Imports the staged files. 'separate' = one binder per file (duplicate
   * names produce duplicate binders). 'merge' = files sharing a name feed a
   * single binder (first file creates it; the rest pin into it).
   */
  const executeImport = async (strategy: 'separate' | 'merge') => {
    setSaving(true);
    setErrorMsg(null);
    setLoading(true);
    try {
      if (importFiles_.length > 0) {
        const groups =
          strategy === 'merge' ? groupIndicesByName() : importFiles_.map((_, i) => [i]);
        for (const idxs of groups) {
          let binderId = '';
          for (let j = 0; j < idxs.length; j++) {
            const i = idxs[j];
            const file = importFiles_[i];
            const draft = binderDrafts[i];
            const result = await importFile(file);
            if (j === 0) {
              await importCards(result, file.name, 'binder', {
                binderName: draft?.name.trim() || stripExtension(file.name),
                binderColor: draft?.color ?? color,
              });
              binderId = useCollectionStore.getState().activeTab;
            } else {
              // Add this file's cards to the collection, then pin them into
              // the binder the group's first file created. pinCardToBinder
              // maintains the durable pin-key shadow.
              await importCards(result, file.name, 'merge', {});
              for (const c of result.cards) pinCardToBinder(binderId, c.copyId);
            }
          }
        }
      } else {
        const result = await importText(importPasteText.trim());
        await importCards(result, 'pasted-list', 'binder', {
          binderName: name.trim(),
          binderColor: color,
        });
      }
      setEditingBinder(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const isImportMode = binderMode === 'import' && isNew;
    const isImportBatch = isImportMode && importFiles_.length > 0;
    // In batch import each staged file names its own binder, so the top-level
    // name field is unused; otherwise a name is required.
    if (!isImportBatch && !name.trim()) {
      setErrorMsg('Name is required');
      return;
    }
    if (isImportMode && !importPasteText.trim() && importFiles_.length === 0) {
      setErrorMsg('Paste a card list or upload one or more CSV files');
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

    // Rules binder (or editing an existing one): synchronous create/update.
    if (existing || !isImportMode) {
      setSaving(true);
      setErrorMsg(null);
      try {
        if (existing) updateBinder(existing.id, input);
        else createBinder(input);
        setEditingBinder(null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Import mode owns binder creation via importCards (one 'manual' pinned
    // binder per source). When staged files resolve to a name that's used
    // twice in the batch OR already exists as a binder, ask the user first.
    if (isImportBatch) {
      const existingNames = new Set(binders.map((b) => b.name.trim().toLowerCase()));
      const collisions = groupIndicesByName()
        .map((g) => ({
          name: draftName(g[0]),
          count: g.length,
          existing: existingNames.has(draftName(g[0]).toLowerCase()),
        }))
        .filter((c) => c.count > 1 || c.existing);
      if (collisions.length > 0) {
        setCollisionPrompt(collisions);
        return;
      }
    }
    await executeImport('separate');
  };

  const showEmptyWarning = areAllGroupsEmpty(groups);
  const capacity = fixedCapacity ?? 0;
  // Suppress over-capacity warning when filters are empty — an unfiltered binder
  // would match every card by definition, which is never what the warning is
  // trying to flag.
  const overCapacity = fixedCapacity !== null && !showEmptyWarning && binderMatchCount > capacity;

  return (
    <>
      <div className="modal-backdrop" onClick={() => setEditingBinder(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{existing ? 'Edit binder' : 'New binder'}</h2>
            <button
              className="modal-close"
              onClick={() => setEditingBinder(null)}
              aria-label="Close"
            >
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
                      onChange={(v) => {
                        const next = v as PocketSize;
                        setFixedCapacity((prev) =>
                          prev !== null && prev === defaultFixedCapacity(pocketSize, doubleSided)
                            ? defaultFixedCapacity(next, doubleSided)
                            : prev
                        );
                        setPocketSize(next);
                      }}
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
                        onChange={(e) => {
                          const next = e.target.checked;
                          setFixedCapacity((prev) =>
                            prev !== null && prev === defaultFixedCapacity(pocketSize, doubleSided)
                              ? defaultFixedCapacity(pocketSize, next)
                              : prev
                          );
                          setDoubleSided(next);
                        }}
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
                            e.target.checked ? defaultFixedCapacity(pocketSize, doubleSided) : null
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
                  ⚠️ This binder matches {binderMatchCount.toLocaleString()} cards but its capacity
                  is only {capacity.toLocaleString()}. The extra{' '}
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
              <div
                className="binder-mode-toggle"
                role="radiogroup"
                aria-label="Binder creation mode"
              >
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
                      ⚠️ This binder has no filters — it will match every remaining card. Add at
                      least one, or place this binder near the bottom of the priority list.
                    </div>
                  )}
                </section>

                {/* Sort */}
                <section className="editor-section">
                  <h3>Sort within binder</h3>
                  <SortEditor
                    sorts={sorts}
                    valueOrders={sortValueOrders}
                    onSortsChange={setSorts}
                    onValueOrdersChange={setSortValueOrders}
                  />
                </section>
              </>
            )}

            {binderMode === 'import' && isNew && (
              <section
                className={`editor-section file-dropzone${importDragging ? ' is-dragging' : ''}`}
                {...importDropProps}
              >
                {importDragging && (
                  <div className="file-drop-overlay" aria-hidden="true">
                    <div className="file-drop-message">Drop file(s) — one binder each</div>
                  </div>
                )}
                <p className="muted" style={{ marginBottom: '0.5rem' }}>
                  Paste a card list, or upload one or more CSV files —{' '}
                  <strong>each file becomes its own binder</strong>. Cards are added to your
                  collection and pinned into their binder in the order listed.
                </p>
                {importFiles_.length > 0 ? (
                  <>
                    <div className="binder-import-head">
                      <strong>
                        {importFiles_.length} file{importFiles_.length === 1 ? '' : 's'} — one
                        binder each
                      </strong>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => applyStagedFiles([], importFiles_)}
                        disabled={saving}
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="binder-import-rows">
                      {importFiles_.map((f, i) => (
                        <li key={f.name} className="binder-import-row">
                          <ColorPicker
                            value={binderDrafts[i]?.color ?? PRESET_COLORS[0].hex}
                            onChange={(hex) =>
                              setBinderDrafts((ds) =>
                                ds.map((d, idx) => (idx === i ? { ...d, color: hex } : d))
                              )
                            }
                            ariaLabel={`Binder color for ${f.name}`}
                          />
                          <div className="binder-import-row-main">
                            <input
                              type="text"
                              className="binder-name-input"
                              value={binderDrafts[i]?.name ?? ''}
                              onChange={(e) =>
                                setBinderDrafts((ds) =>
                                  ds.map((d, idx) =>
                                    idx === i ? { ...d, name: e.target.value } : d
                                  )
                                )
                              }
                              placeholder={stripExtension(f.name)}
                              maxLength={60}
                              disabled={saving}
                              aria-label={`Binder name for ${f.name}`}
                            />
                            <span className="binder-import-row-file">{f.name}</span>
                          </div>
                          <button
                            type="button"
                            className="staged-files-remove"
                            onClick={() =>
                              applyStagedFiles(
                                importFiles_.filter((_, idx) => idx !== i),
                                importFiles_
                              )
                            }
                            disabled={saving}
                            aria-label={`Remove ${f.name}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    {importStageNote && (
                      <p className="muted" style={{ marginTop: '0.25rem' }}>
                        {importStageNote}
                      </p>
                    )}
                  </>
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
                    Upload files
                  </button>
                  <input
                    type="file"
                    ref={importFileRef}
                    accept=".csv,.tsv,.txt"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const incoming = e.target.files ? Array.from(e.target.files) : [];
                      if (importFileRef.current) importFileRef.current.value = '';
                      stageIncoming(incoming);
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

      {collisionPrompt && (
        <div className="modal-backdrop" onClick={() => setCollisionPrompt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="choice-dialog-title">Some binder names need a decision</h2>
            <ul className="choice-dialog-body" style={{ paddingLeft: '1.1rem' }}>
              {collisionPrompt.map((c) => (
                <li key={c.name}>
                  <strong>"{c.name}"</strong>
                  {c.count > 1 ? ` — ${c.count} staged files share this name` : ''}
                  {c.existing
                    ? `${c.count > 1 ? '; it' : ' —'} also matches a binder you already have`
                    : ''}
                </li>
              ))}
            </ul>
            <div className="choice-dialog-options">
              {collisionPrompt.some((c) => c.count > 1) && (
                <button
                  type="button"
                  className="choice-dialog-option"
                  onClick={() => {
                    setCollisionPrompt(null);
                    void executeImport('merge');
                  }}
                  autoFocus
                >
                  <span className="choice-dialog-option-title">Merge same-named files</span>
                  <span className="choice-dialog-option-desc">
                    Files that share a name go into one new binder together. Other files still get
                    their own binder.
                    {collisionPrompt.some((c) => c.existing)
                      ? ' (Still creates new binders — existing same-named binders are left alone.)'
                      : ''}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="choice-dialog-option"
                onClick={() => {
                  setCollisionPrompt(null);
                  void executeImport('separate');
                }}
              >
                <span className="choice-dialog-option-title">Create separate binders</span>
                <span className="choice-dialog-option-desc">
                  Keep one binder per file — you'll get additional binders with the same name
                  {collisionPrompt.some((c) => c.existing)
                    ? ', including alongside the existing ones'
                    : ''}
                  .
                </span>
              </button>
              <button
                type="button"
                className="choice-dialog-option"
                onClick={() => setCollisionPrompt(null)}
              >
                <span className="choice-dialog-option-title">Let me rename them</span>
                <span className="choice-dialog-option-desc">
                  Go back to the list and edit the binder names first.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
        <ChipExpressionBuilder
          options={FORMATS.map((f) => ({ value: f, label: f }))}
          value={filter.legalities ?? EMPTY_EXPR}
          onChange={(next) => patch({ legalities: next })}
          defaultJoiner="OR"
          placeholder="Add format..."
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
        <ChipExpressionBuilder
          value={filter.typeChips ?? EMPTY_EXPR}
          onChange={(next) => patch({ typeChips: next })}
          suggestions={typeSuggestions}
          defaultJoiner="OR"
          placeholder="e.g. creature, angel, legendary"
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
        <ChipExpressionBuilder
          value={filter.oracleChips ?? EMPTY_EXPR}
          onChange={(next) => patch({ oracleChips: next })}
          suggestions={oracleSuggestions}
          defaultJoiner="OR"
          placeholder="e.g. flying, draw a card"
        />
      </div>

      {/* Commander eligibility */}
      <div className="rule-row">
        <span
          className="rule-label has-tooltip"
          title="Matches legal commanders: legendary creatures and cards that say 'can be your commander' (e.g. planeswalker-commanders), legal in the Commander format."
        >
          Commander <span className="tooltip-marker">ⓘ</span>
        </span>
        <div className="rule-segmented" role="radiogroup" aria-label="Commander eligibility">
          <button
            type="button"
            role="radio"
            aria-checked={filter.commanderEligible === undefined}
            className={`rule-segmented-pill${filter.commanderEligible === undefined ? ' active' : ''}`}
            onClick={() => patch({ commanderEligible: undefined })}
          >
            Any
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filter.commanderEligible === true}
            className={`rule-segmented-pill${filter.commanderEligible === true ? ' active' : ''}`}
            onClick={() => patch({ commanderEligible: true })}
          >
            Is
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filter.commanderEligible === false}
            className={`rule-segmented-pill${filter.commanderEligible === false ? ' active' : ''}`}
            onClick={() => patch({ commanderEligible: false })}
          >
            Is not
          </button>
        </div>
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
        <ChipExpressionBuilder
          options={FINISHES.map((f) => ({ value: f.key, label: f.label }))}
          value={filter.finishes ?? EMPTY_EXPR}
          onChange={(next) => patch({ finishes: next })}
          defaultJoiner="OR"
          placeholder="Add finish..."
        />
      </div>

      {/* Layout */}
      <div className="rule-row">
        <span className="rule-label">Layout</span>
        <ChipExpressionBuilder
          options={LAYOUTS.map((l) => ({ value: l.key, label: l.label }))}
          value={filter.layouts ?? EMPTY_EXPR}
          onChange={(next) => patch({ layouts: next })}
          defaultJoiner="OR"
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
        <ChipExpressionBuilder
          options={TREATMENT_OPTIONS.map((t) => ({ value: t.key, label: t.label }))}
          value={filter.treatments ?? EMPTY_EXPR}
          onChange={(next) => patch({ treatments: next })}
          defaultJoiner="OR"
          placeholder="Add treatment..."
        />
      </div>

      {/* Border */}
      <div className="rule-row">
        <span className="rule-label">Border</span>
        <ChipExpressionBuilder
          options={BORDER_OPTIONS.map((b) => ({ value: b.key, label: b.label }))}
          value={filter.borderColors ?? EMPTY_EXPR}
          onChange={(next) => patch({ borderColors: next })}
          defaultJoiner="OR"
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

/** Deep-clone the chip fields of a filter (so duplication doesn't share mutable refs). */
function cloneChips(f: BinderFilter): Partial<BinderFilter> {
  const dup = (expr?: ChipExpression): ChipExpression | undefined =>
    expr ? { chips: expr.chips.map((c) => ({ ...c })), joiners: [...expr.joiners] } : undefined;
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

// cleanFilter moved to ../lib/clean-filter (pure, unit-tested, coverage-gated).

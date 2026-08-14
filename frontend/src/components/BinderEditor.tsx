import { useState, useEffect, useId, useMemo, useRef } from 'react';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { importFile, importText, type ImportProgressCallback } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { mergeStagedFiles, stagedFilesNotice, stripExtension } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { NEW_BINDER_DEFAULT_SORTS } from '../lib/sorting';
import { SortEditor } from './SortEditor';
import { areAllGroupsEmpty } from '../lib/rules';
import { countBinderMatches, countEffectiveLanding } from '../lib/binder-counts';
import { useCardsWithTags, groupsUseTags } from '../lib/card-tags';
import { cleanFilter } from '../lib/clean-filter';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { SelectMenu } from './SelectMenu';
import { ColorPicker } from './ColorPicker';
import { PRESET_COLORS, pickRandomPresetColor } from '../lib/preset-colors';
import { isNativePlatform } from '../lib/platform';
import { pickNativeFiles } from '../lib/native-file-picker';
import { InfoTip } from './InfoTip';
import { FilterGroupList, cloneChips, validateRanges } from './FilterGroupEditor';

const BINDER_IMPORT_MIME = ['text/csv', 'text/tab-separated-values', 'text/plain'];
import type {
  BinderFilter,
  BinderFilterGroup,
  BinderInput,
  PocketSize,
  SortEntry,
  SortField,
} from '../types';

const EMPTY_FILTER: BinderFilter = {};
const newGroup = (): BinderFilterGroup => ({ filter: {} });

// Starter templates (pre-fill patterns for a new binder's first rule group)
// live in lib/binder-templates.ts, consumed by ./FilterGroupEditor.

// ── InfoTip copy ───────────────────────────────────────────────────────────
// Rule-group concept tooltip (mounted once on the "Filters" section heading).
const RULE_GROUP_TIP = (
  <>
    <p className="info-tip-lead">
      A <strong>rule group</strong> is one set of AND-rules that can route cards into this binder.
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Within a group:</strong> every active rule must match — a card must satisfy Color
        AND Rarity AND Price (AND so on).
      </li>
      <li>
        <strong>Between groups:</strong> OR — a card joins if it matches <em>any</em> group. Use
        multiple groups for binders like "Rares OR cards worth $5+."
      </li>
    </ul>
  </>
);

// Default fixed capacity in cards for a given layout: 20 sheet-sides per page
// (40 when double-sided, since each sheet stores cards on both sides).
const defaultFixedCapacity = (pocket: PocketSize, doubleSided: boolean): number =>
  pocket * (doubleSided ? 40 : 20);

export function BinderEditor() {
  const editingBinder = useCollectionStore((s) => s.editingBinder);
  const editingBinderSeed = useCollectionStore((s) => s.editingBinderSeed);
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
  const [tradeable, setTradeable] = useState(false);
  const [fixedCapacity, setFixedCapacity] = useState<number | null>(null);
  // Raw text mirror of fixedCapacity — lets the field go blank/mid-edit; the
  // clamp only runs at commit (blur/Enter), not on every keystroke. Resynced
  // from fixedCapacity during render (not an effect — avoids
  // react-hooks/set-state-in-effect) whenever it changes for a reason other
  // than typing (the Fixed checkbox, pocket-size/double-sided defaults, or
  // loading an existing binder).
  const [fixedCapacityText, setFixedCapacityText] = useState('');
  const [prevFixedCapacity, setPrevFixedCapacity] = useState(fixedCapacity);
  if (prevFixedCapacity !== fixedCapacity) {
    setPrevFixedCapacity(fixedCapacity);
    if (fixedCapacity !== null) setFixedCapacityText(String(fixedCapacity));
  }
  const [showDeckAllocated, setShowDeckAllocated] = useState(true);
  const [keepPrintingsTogether, setKeepPrintingsTogether] = useState(false);
  const [sectionMode, setSectionMode] = useState<'sort' | 'group'>('sort');
  // Radios group by shared `name` — scope each group to this editor instance.
  const sectionModeGroup = useId();
  const binderModeGroup = useId();
  const [pageBreakDepth, setPageBreakDepth] = useState<number>(1);
  const [packSections, setPackSections] = useState(false);
  const [groups, setGroups] = useState<BinderFilterGroup[]>([newGroup()]);
  const [routingMode, setRoutingMode] = useState<'rules' | 'manual'>('rules');
  const [sorts, setSorts] = useState<SortEntry[]>([...NEW_BINDER_DEFAULT_SORTS]);
  const [sortValueOrders, setSortValueOrders] = useState<Partial<Record<SortField, string[]>>>({});
  const [saving, setSaving] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    chunkIndex: number;
    totalChunks: number;
    fileLabel?: string;
    fileIndex?: number;
    totalFiles?: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState('');
  // After adding a group, set this to the new index so the group's name input can autofocus.
  const [autofocusGroupIdx, setAutofocusGroupIdx] = useState<number | null>(null);
  const [binderMode, setBinderMode] = useState<'rules' | 'import'>('rules');
  const [importPasteText, setImportPasteText] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importFiles_, setImportFiles] = useState<File[]>([]);
  /** "These are all proxies" toggle for the binder-import UI. */
  const [importAsProxies, setImportAsProxies] = useState(false);
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

    // Cancelled on cleanup: the catalog promises can outlive the editor
    // (a post-teardown setState flaked CI in the CardListTable twin of this).
    let cancelled = false;
    fetchTypeSuggestions().then((catalog) => {
      if (cancelled) return;
      const merged = [...new Set([...catalog, ...collectionTokens])].sort((a, b) =>
        a.localeCompare(b)
      );
      setTypeSuggestions(merged);
    });

    fetchOracleSuggestions().then((catalog) => {
      if (cancelled) return;
      setOracleSuggestions(catalog);
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the editor opens (isOpen), not on every card change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Sync form fields from props when the modal opens. Use the render-phase reset
  // pattern: track the last `isOpen`/`existing`/`editingBinderSeed` triple we
  // initialized for, and re-init whenever any of them changes while the modal
  // is open. Tracking editingBinderSeed ensures re-opening 'new' with a fresh
  // seed (e.g. "Save as binder" with different filters) re-seeds name+groups.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevExisting, setPrevExisting] = useState(existing);
  const [prevSeed, setPrevSeed] = useState(editingBinderSeed);
  if (prevIsOpen !== isOpen || prevExisting !== existing || prevSeed !== editingBinderSeed) {
    setPrevIsOpen(isOpen);
    setPrevExisting(existing);
    setPrevSeed(editingBinderSeed);
    if (isOpen) {
      if (existing) {
        setName(existing.name);
        setColor(existing.color);
        setPocketSize(existing.pocketSize ?? 9);
        setDoubleSided(!!existing.doubleSided);
        setTradeable(!!existing.tradeable);
        setFixedCapacity(existing.fixedCapacity ?? null);
        setShowDeckAllocated(existing.hideDeckAllocated !== false);
        setKeepPrintingsTogether(!!existing.keepPrintingsTogether);
        setSectionMode(existing.sectionMode ?? 'sort');
        setPageBreakDepth(existing.pageBreakDepth ?? 1);
        setPackSections(!!existing.packSections);
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
        setName(editingBinderSeed?.name ?? '');
        setColor(nextRandomColor);
        setPocketSize(9);
        setDoubleSided(false);
        setTradeable(false);
        setFixedCapacity(null);
        setShowDeckAllocated(true);
        setKeepPrintingsTogether(false);
        setSectionMode('sort');
        setPageBreakDepth(1);
        setGroups(editingBinderSeed?.groups?.length ? editingBinderSeed.groups : [newGroup()]);
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

  // Close the topmost open dialog on Escape (collision prompt wins, since it
  // renders above the editor).
  useEffect(() => {
    if (!isOpen && !collisionPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (collisionPrompt) setCollisionPrompt(null);
      else setEditingBinder(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, collisionPrompt, setEditingBinder]);

  // Over-capacity check uses the same estimate the editor shows: when
  // "keep all printings together" is on, count the printings it pulls in too,
  // so the warning doesn't silently under-count.
  // Decorate with oracle tags so the live counts reflect a draft tag rule
  // (gated on the *draft* groups, since the binder isn't committed yet). Feeds
  // BOTH the over-capacity check below AND the per-group badge in
  // FilterGroupList — passing the raw `cards` there left an oracle-tag rule's
  // count stuck at 0 until the tagger snapshot finished loading.
  const taggedCards = useCardsWithTags(cards, groupsUseTags(groups));
  const binderMatchCount = useMemo(() => {
    if (fixedCapacity === null) return 0;
    return countBinderMatches(taggedCards, groups, keepPrintingsTogether).total;
  }, [taggedCards, groups, fixedCapacity, keepPrintingsTogether]);

  // Where the waterfall actually seats this binder's cards, not just how many
  // match its own rules — substitutes the draft into the real binder list (in
  // position order) so a binder placed behind a broader one shows the truth:
  // it may match plenty of cards and still land none of them. Skipped for
  // manual-mode binders, which don't route by rules at all.
  const effectiveLanding = useMemo(() => {
    if (routingMode === 'manual') return null;
    return countEffectiveLanding(taggedCards, binders, {
      id: existing?.id ?? null,
      groups,
      keepPrintingsTogether,
      mode: routingMode,
    });
  }, [taggedCards, binders, groups, keepPrintingsTogether, routingMode, existing?.id]);

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
    setImportProgress(null);
    try {
      if (importFiles_.length > 0) {
        const groups =
          strategy === 'merge' ? groupIndicesByName() : importFiles_.map((_, i) => [i]);
        const totalFiles = importFiles_.length;
        let fileOrdinal = 0;
        for (const idxs of groups) {
          let binderId = '';
          for (let j = 0; j < idxs.length; j++) {
            const i = idxs[j];
            const file = importFiles_[i];
            const draft = binderDrafts[i];
            fileOrdinal += 1;
            const currentFileOrdinal = fileOrdinal;
            const onProgress: ImportProgressCallback = (prog) =>
              setImportProgress({
                chunkIndex: prog.chunkIndex,
                totalChunks: prog.totalChunks,
                fileLabel: file.name,
                fileIndex: currentFileOrdinal,
                totalFiles,
              });
            const result = await importFile(file, onProgress, importAsProxies);
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
        const result = await importText(
          importPasteText.trim(),
          (prog) =>
            setImportProgress({ chunkIndex: prog.chunkIndex, totalChunks: prog.totalChunks }),
          importAsProxies
        );
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
      setImportProgress(null);
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
    // ⚠️ This is a FIELD WHITELIST: every persistable BinderDef field must be
    // listed here explicitly. A BinderDef field omitted here is silently
    // dropped on save (the editor preview reads local state and looks fine,
    // but the reloaded binder loses it). Add new fields here when extending
    // BinderDef. (Same trap that hit BinderFilter via cleanFilter.)
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
      keepPrintingsTogether: keepPrintingsTogether || undefined,
      tradeable: tradeable || undefined,
      sectionMode: sectionMode !== 'sort' ? sectionMode : undefined,
      pageBreakDepth: pageBreakDepth > 1 ? pageBreakDepth : undefined,
      packSections: packSections || undefined,
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
      <div className="modal-backdrop" role="presentation" onClick={() => setEditingBinder(null)}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="binder-editor-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="binder-editor-title">{existing ? 'Edit binder' : 'New binder'}</h2>
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
                          value={fixedCapacityText}
                          onChange={(e) => setFixedCapacityText(e.target.value)}
                          onBlur={() => {
                            const cards = parseInt(fixedCapacityText);
                            const next = Number.isFinite(cards) && cards > 0 ? cards : 1;
                            setFixedCapacity(next);
                            setFixedCapacityText(String(next));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          aria-label="Capacity in cards"
                          style={{ width: 100 }}
                        />
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
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
                  This binder matches {binderMatchCount.toLocaleString()} cards but its capacity is
                  only {capacity.toLocaleString()}. The extra{' '}
                  {(binderMatchCount - capacity).toLocaleString()} won't fit physically — they'll
                  still display, just flagged as over-capacity.
                </div>
              )}
              <div className="editor-row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Deck / cube cards</label>
                  <label
                    className="field-checkbox"
                    style={{ margin: 0 }}
                    title="When off, cards currently allocated to any deck or cube are hidden from this binder until they are released. Pins and manual order are preserved."
                  >
                    <input
                      type="checkbox"
                      checked={showDeckAllocated}
                      onChange={(e) => setShowDeckAllocated(e.target.checked)}
                    />
                    Show cards that are in a deck or cube
                  </label>
                </div>
              </div>
              <div className="editor-row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Printings</label>
                  <label
                    className="field-checkbox"
                    style={{ margin: 0 }}
                    title="When on, if any printing you own of a card matches this binder's rules, all your copies of that card join the binder — not just the printings that matched (e.g. a pricey commander brings its cheap copies along). Only reclaims cards not already in another binder. Ignored for manual binders."
                  >
                    <input
                      type="checkbox"
                      checked={keepPrintingsTogether}
                      onChange={(e) => setKeepPrintingsTogether(e.target.checked)}
                    />
                    Keep all printings together
                  </label>
                </div>
              </div>
              <div className="editor-row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Trading</label>
                  <label
                    className="field-checkbox"
                    style={{ margin: 0 }}
                    title="Cards in this binder can show up in a game night's trade board when you opt in."
                  >
                    <input
                      type="checkbox"
                      checked={tradeable}
                      onChange={(e) => setTradeable(e.target.checked)}
                    />
                    Available to trade
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
              <fieldset className="binder-mode-toggle" aria-label="Binder creation mode">
                {(
                  [
                    { v: 'rules', label: 'Build with rules' },
                    { v: 'import', label: 'Import a list' },
                  ] as const
                ).map(({ v, label }) => (
                  <label key={v} className={`binder-mode-pill${binderMode === v ? ' active' : ''}`}>
                    <input
                      type="radio"
                      name={binderModeGroup}
                      value={v}
                      checked={binderMode === v}
                      onChange={() => setBinderMode(v)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
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
                    <h3 className="filter-section-heading">
                      Filters <InfoTip label="rule groups" text={RULE_GROUP_TIP} wide />
                      <span className="muted">
                        {groups.length === 1
                          ? '— a card joins this binder if it matches every filter below'
                          : '— a card joins this binder if it matches any rule group below'}
                      </span>
                    </h3>

                    {isNew &&
                      editingBinderSeed?.flagged &&
                      editingBinderSeed.flagged.length > 0 && (
                        <p
                          className="binder-seed-note"
                          style={{
                            color: 'var(--text-secondary)',
                            fontSize: 'var(--text-sm)',
                            marginBottom: 'var(--space-2)',
                          }}
                        >
                          Some filters weren&apos;t carried over or match differently in a binder:{' '}
                          {editingBinderSeed.flagged
                            .map((key) => {
                              if (key === 'condition') return 'condition';
                              if (key === 'binder') return 'binder membership';
                              if (key === 'color')
                                return 'color (binders match exact color identity)';
                              return key;
                            })
                            .join(', ')}
                          .
                        </p>
                      )}

                    <FilterGroupList
                      groups={groups}
                      cards={taggedCards}
                      keepPrintingsTogether={keepPrintingsTogether}
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
                      isNewBinder={isNew}
                    />
                  </div>

                  {effectiveLanding && (
                    <p className="muted" style={{ marginTop: '0.5rem' }}>
                      {effectiveLanding.matches.toLocaleString()}{' '}
                      {effectiveLanding.matches === 1 ? 'card matches' : 'cards match'} ·{' '}
                      {effectiveLanding.lands.toLocaleString()} will land here
                      {effectiveLanding.caughtAbove > 0 && (
                        <>
                          {' '}
                          · {effectiveLanding.caughtAbove.toLocaleString()} caught by binders above
                          this one
                        </>
                      )}
                      {effectiveLanding.pulledIn > 0 && (
                        <>
                          {' '}
                          · +{effectiveLanding.pulledIn.toLocaleString()} pulled in by keep
                          printings together
                        </>
                      )}
                    </p>
                  )}

                  {effectiveLanding &&
                    effectiveLanding.matches > 0 &&
                    effectiveLanding.lands === 0 && (
                      <div className="warn-banner" style={{ marginTop: '0.5rem' }}>
                        Every matching card is caught by a binder above this one — this binder will
                        be empty. Move it up, or tighten the rules of the binders above.
                      </div>
                    )}

                  <div className="sr-only" role="status" aria-live="polite">
                    {liveMsg}
                  </div>

                  {showEmptyWarning && (
                    <div className="warn-banner" style={{ marginTop: '0.75rem' }}>
                      This binder has no filters — it will match every remaining card. Add at least
                      one, or place this binder near the bottom of the priority list.
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
                  {groups.length >= 2 && (
                    <div className="editor-row" style={{ marginTop: '0.75rem' }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Sections</label>
                        <fieldset
                          aria-label="Section mode"
                          className="binder-mode-toggle"
                          style={{ display: 'inline-flex' }}
                        >
                          {(
                            [
                              { v: 'sort', label: 'By sort field' },
                              { v: 'group', label: 'By rule group' },
                            ] as const
                          ).map(({ v, label }) => (
                            <label
                              key={v}
                              className={`binder-mode-pill${sectionMode === v ? ' active' : ''}`}
                            >
                              <input
                                type="radio"
                                name={sectionModeGroup}
                                value={v}
                                checked={sectionMode === v}
                                onChange={() => setSectionMode(v)}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </fieldset>
                      </div>
                    </div>
                  )}
                  {sectionMode !== 'group' && (
                    <div className="editor-row" style={{ marginTop: '0.75rem' }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Page filling</label>
                        <label
                          className="field-checkbox"
                          style={{ margin: 0 }}
                          title="Off, every section starts its own page — clean, but many small sections leave most pockets empty. On, consecutive sections share a page whenever they both fit, and a section is still never split across a page boundary. Built for Secret Lair drops, where 35 drops of 1–7 cards would otherwise burn 39 pages to hold 199 cards."
                        >
                          <input
                            type="checkbox"
                            checked={packSections}
                            onChange={(e) => setPackSections(e.target.checked)}
                          />
                          Fit several sections per page
                        </label>
                        <span
                          className="sort-page-break-hint"
                          style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}
                        >
                          {packSections
                            ? 'Sections share a page when they fit — but none is ever split across two pages.'
                            : 'Every section starts a new page, leaving the rest of it empty.'}
                        </span>
                      </div>
                    </div>
                  )}
                  {sectionMode !== 'group' && sorts.length > 1 && (
                    <div className="editor-row" style={{ marginTop: '0.75rem' }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Page breaks</label>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <SelectMenu
                            ariaLabel="Page break depth"
                            value={pageBreakDepth}
                            onChange={(v) => setPageBreakDepth(v as number)}
                            options={Array.from({ length: sorts.length }, (_, i) => ({
                              value: i + 1,
                              label:
                                i === 0
                                  ? 'Section headers only (default)'
                                  : `First ${i + 1} sort levels`,
                            }))}
                          />
                          <span
                            className="sort-page-break-hint"
                            style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}
                          >
                            {pageBreakDepth <= 1
                              ? 'Each section header starts a new page; deeper sorts order within the page.'
                              : `Each ${pageBreakDepth === 2 ? 'secondary' : `level-${pageBreakDepth}`} group starts its own page — empty pockets are accepted.`}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
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
                    onClick={async () => {
                      if (isNativePlatform()) {
                        try {
                          const files = await pickNativeFiles({
                            types: BINDER_IMPORT_MIME,
                            multiple: true,
                          });
                          stageIncoming(files);
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : "Couldn't open file picker"
                          );
                        }
                        return;
                      }
                      importFileRef.current?.click();
                    }}
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
                <label
                  className="field-checkbox import-proxy-toggle"
                  style={{ marginTop: '0.5rem' }}
                >
                  <input
                    type="checkbox"
                    checked={importAsProxies}
                    onChange={(e) => setImportAsProxies(e.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    Mark all as proxies
                    <InfoTip
                      label="marking an import as proxies"
                      ariaLabel="What does marking an import as proxies do?"
                      text="Proxy copies count as owned in this binder, but carry no market value — their cost, if any, still counts toward what you paid."
                    />
                  </span>
                </label>
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
                ? importProgress && importProgress.totalChunks > 1
                  ? importProgress.totalFiles && importProgress.totalFiles > 1
                    ? `File ${importProgress.fileIndex}/${importProgress.totalFiles} · batch ${importProgress.chunkIndex}/${importProgress.totalChunks}…`
                    : `Importing batch ${importProgress.chunkIndex} of ${importProgress.totalChunks}…`
                  : 'Saving...'
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
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCollisionPrompt(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="binder-collision-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="choice-dialog-title" id="binder-collision-title">
              Some binder names need a decision
            </h2>
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

// cleanFilter moved to ../lib/clean-filter (pure, unit-tested, coverage-gated).

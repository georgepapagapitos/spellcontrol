import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { importFile, importText, type ImportProgressCallback } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { mergeStagedFiles, stagedFilesNotice, stripExtension } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { NEW_BINDER_DEFAULT_SORTS, SORT_FIELDS, sortDirectionLabel } from '../lib/sorting';
import { useAnchoredPanel } from '../lib/use-anchored-panel';
import { SortEditor } from './SortEditor';
import { areAllGroupsEmpty } from '../lib/rules';
import {
  countBinderMatches,
  countEffectiveLanding,
  type EffectiveLandingCounts,
} from '../lib/binder-counts';
import { STARTER_TEMPLATES } from '../lib/binder-templates';
import { useCardsWithTags, groupsUseTags } from '../lib/card-tags';
import { cleanFilter } from '../lib/clean-filter';
import { Modal } from './Modal';
import { SelectMenu } from './SelectMenu';
import { ColorPicker } from './ColorPicker';
import { PRESET_COLORS, pickRandomPresetColor } from '../lib/preset-colors';
import { InfoTip } from './InfoTip';
import { FilterGroupList, cloneChips, validateRanges } from './FilterGroupEditor';
import { BinderStartChooser, type BinderStart } from './BinderStartChooser';
import { ChoiceList, Disclosure, Field, SegmentedControl, SwitchRow } from './shared/form';
import './BinderEditor.css';

import type {
  BinderFilter,
  BinderFilterGroup,
  BinderInput,
  PocketSize,
  SortEntry,
  SortField,
} from '../types';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';
const EMPTY_FILTER: BinderFilter = {};
const newGroup = (): BinderFilterGroup => ({ filter: {} });

// Starter templates (pre-fill patterns for a new binder's first rule group)
// live in lib/binder-templates.ts, consumed by ./FilterGroupEditor.

// ── InfoTip copy ───────────────────────────────────────────────────────────
// The one explanation of how rules combine, on the "Cards" heading. It
// replaces three always-on paragraphs (the heading sentence, the OR help and
// the per-group hint) that explained the structure because it didn't.
const CARDS_TIP = (
  <>
    <p className="info-tip-lead">How a card lands here</p>
    <ul className="info-tip-list">
      <li>
        <strong>A rule</strong> takes a card when it matches every condition in it.
      </li>
      <li>
        <strong>More rules</strong> are alternatives: a card that matches any of them lands here.
      </li>
      <li>
        <strong>Binders higher in your list</strong> claim their cards first.
      </li>
    </ul>
  </>
);

// Default fixed capacity in cards for a given layout: 20 sheet-sides per page
// (40 when double-sided, since each sheet stores cards on both sides).
const defaultFixedCapacity = (pocket: PocketSize, doubleSided: boolean): number =>
  pocket * (doubleSided ? 40 : 20);

/**
 * "Staples", "Staples and Rares", or "Staples and 3 others" — names the binders
 * outbidding this one instead of the anonymous "binders above this one" (E298).
 * Two names is the readable ceiling for an inline sentence; beyond that the
 * count carries it and the binder list itself shows the order.
 */
function formatCaughtBy(
  caughtBy: { binderName: string; count: number }[],
  fallback = 'binders above this one'
): string {
  if (caughtBy.length === 0) return fallback;
  if (caughtBy.length === 1) return caughtBy[0].binderName;
  if (caughtBy.length === 2) return `${caughtBy[0].binderName} and ${caughtBy[1].binderName}`;
  return `${caughtBy[0].binderName} and ${caughtBy.length - 1} others`;
}

const PACK_LABEL: Record<string, string> = {
  false: 'New page per section',
  true: 'Fit whole sections',
  continuous: 'No gaps',
};

const STARTER_LABELS = new Set(STARTER_TEMPLATES.map((t) => t.label));

/** The page's pocket grid, drawn: 2×2, 3×3 or 4×3. The number sits beside it. */
function PocketGlyph({ pockets }: { pockets: PocketSize }) {
  const cols = pockets === 4 ? 2 : pockets === 12 ? 4 : 3;
  const rows = pockets === 4 ? 2 : 3;
  const cell = 3.2;
  const gap = 1.2;
  const w = cols * cell + (cols - 1) * gap;
  const h = rows * cell + (rows - 1) * gap;
  return (
    <svg width={w * 1.25} height={h * 1.25} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {Array.from({ length: pockets }, (_, i) => (
        <rect
          key={i}
          x={(i % cols) * (cell + gap)}
          y={Math.floor(i / cols) * (cell + gap)}
          width={cell}
          height={cell}
          rx={0.6}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** The binder's tab colour as a dot beside its name; the picker opens on tap. */
function ColorDot({
  value,
  onChange,
  label = 'Tab color',
}: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}) {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel({ align: 'left' });
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="binder-color-dot"
        style={{ '--dot-color': value } as CSSProperties}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronDown width={10} height={10} strokeWidth={2.5} aria-hidden />
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="binder-color-panel"
            role="dialog"
            aria-label={label}
            style={panelStyle}
          >
            <ColorPicker value={value} onChange={onChange} ariaLabel={label} />
          </div>,
          document.body
        )}
    </>
  );
}

/** The footer's answer: how many cards this binder will actually hold. */
function FooterResult({
  step,
  routingMode,
  pinned,
  landing,
  fileCount,
}: {
  step: 'start' | 'rules' | 'import';
  routingMode: 'rules' | 'manual';
  pinned: number;
  landing: EffectiveLandingCounts | null;
  fileCount: number;
}) {
  if (step === 'import') {
    return (
      <div className="binder-editor-result">
        <strong>{fileCount > 1 ? `${fileCount} binders` : 'One binder'}</strong>
        <small>Cards are added to your collection, kept in your order.</small>
      </div>
    );
  }
  if (routingMode === 'manual') {
    return (
      <div className="binder-editor-result">
        <strong>
          {pinned.toLocaleString()} pinned {pinned === 1 ? 'card' : 'cards'}
        </strong>
        <small>Manual mode: rules are paused.</small>
      </div>
    );
  }
  if (!landing) return <div className="binder-editor-result" />;
  const parts = [`${landing.matches.toLocaleString()} match`];
  if (landing.caughtAbove > 0) {
    parts.push(
      `${landing.caughtAbove.toLocaleString()} go to ${formatCaughtBy(landing.caughtBy)}, above`
    );
  }
  if (landing.pulledIn > 0) {
    parts.push(`+${landing.pulledIn.toLocaleString()} other printings`);
  }
  return (
    <div className={`binder-editor-result${landing.lands === 0 ? ' is-zero' : ''}`}>
      <strong>
        <span className="binder-editor-result-n">{landing.lands.toLocaleString()}</span>{' '}
        {landing.lands === 1 ? 'card lands' : 'cards land'} here
      </strong>
      <small>{parts.join(' · ')}</small>
    </div>
  );
}

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
  const moveBinderAbove = useCollectionStore((s) => s.moveBinderAbove);
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
  const [pageBreakDepth, setPageBreakDepth] = useState<number>(1);
  const [packSections, setPackSections] = useState<false | true | 'continuous'>(false);
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
  // Has the user authored anything yet (edited a rule group, or tried to
  // save)? Gates the "no filters" warning on a NEW binder: a blank form is
  // not a mistake, so the amber banner waits until there is something to
  // warn about. Existing binders and named drafts warn straight away.
  const [touched, setTouched] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
  // After adding a group, set this to the new index so the group's name input can autofocus.
  const [autofocusGroupIdx, setAutofocusGroupIdx] = useState<number | null>(null);
  // A new binder opens on its starting point; editing (or a seeded "Save as a
  // binder") goes straight to the rules.
  const [step, setStep] = useState<'start' | 'rules' | 'import'>('rules');
  // Bumped by the "A set binder" start: add a Sets condition and reveal it.
  const [revealSetsSignal, setRevealSetsSignal] = useState(0);
  // A pending "Move above <binder>" from the everything-is-caught warning.
  // Previewed in the counts now, applied on save like every other edit.
  const [placeAboveId, setPlaceAboveId] = useState<string | null>(null);
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
  // Gated on `isOpen` like every other memo below: this component sits in the
  // Layout on every signed-in route, and a closed editor must cost nothing
  // (the ungated version walked and materialised the whole collection on
  // every page load — E276).
  const ownedSets = useMemo(() => {
    const map = new Map<string, string>(); // code → name
    if (!isOpen) return [];
    for (const c of cards) {
      const code = c.setCode.toUpperCase();
      if (!map.has(code)) map.set(code, c.setName || code);
    }
    return Array.from(map.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards, isOpen]);

  // Autocomplete suggestions for type-line and oracle-text chips.
  // Scryfall catalog data is fetched once and merged with tokens from the collection.
  const [typeSuggestions, setTypeSuggestions] = useState<string[]>([]);
  const [oracleSuggestions, setOracleSuggestions] = useState<string[]>([]);

  useEffect(() => {
    // Only while the editor is open. <BinderEditor/> is mounted in the Layout
    // on every signed-in route, and without this guard each page load fired
    // eleven Scryfall catalog requests from the browser for an editor nobody
    // had opened — the nightly journey caught it as a 429 burst on every
    // screen (2026-09-09). The catalogs are cached per session, so opening
    // the editor pays once.
    if (!isOpen) return;
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
        setPackSections(
          existing.packSections === 'continuous' ? 'continuous' : !!existing.packSections
        );
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
      setTouched(false);
      setLiveMsg('');
      setAutofocusGroupIdx(null);
      setStep(existing || editingBinderSeed?.groups?.length ? 'rules' : 'start');
      setRevealSetsSignal(0);
      setPlaceAboveId(null);
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

  // Body-scroll lock, Escape and focus trap/restore all come from
  // <Modal> below. The hand-rolled Escape listener this replaced also had to
  // special-case "collision prompt wins"; useOverlayLayer resolves that by
  // mount order instead.

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
    if (!isOpen || fixedCapacity === null) return 0;
    return countBinderMatches(taggedCards, groups, keepPrintingsTogether).total;
  }, [taggedCards, groups, fixedCapacity, keepPrintingsTogether, isOpen]);

  // Where the waterfall actually seats this binder's cards, not just how many
  // match its own rules — substitutes the draft into the real binder list (in
  // position order) so a binder placed behind a broader one shows the truth:
  // it may match plenty of cards and still land none of them. Skipped for
  // manual-mode binders, which don't route by rules at all — and while closed,
  // where it was a full binder materialisation on every signed-in page (E276).
  const effectiveLanding = useMemo(() => {
    if (!isOpen || routingMode === 'manual') return null;
    return countEffectiveLanding(taggedCards, binders, {
      id: existing?.id ?? null,
      groups,
      keepPrintingsTogether,
      mode: routingMode,
      placeAboveId,
    });
  }, [
    taggedCards,
    binders,
    groups,
    keepPrintingsTogether,
    routingMode,
    existing?.id,
    isOpen,
    placeAboveId,
  ]);

  if (!isOpen) return null;

  const updateGroup = (idx: number, patch: (g: BinderFilterGroup) => BinderFilterGroup) => {
    setTouched(true);
    setGroups((prev) => prev.map((g, i) => (i === idx ? patch(g) : g)));
  };

  const patchFilter = (idx: number, p: Partial<BinderFilter>) =>
    updateGroup(idx, (g) => ({ ...g, filter: { ...g.filter, ...p } }));

  const setGroupName = (idx: number, name: string) => updateGroup(idx, (g) => ({ ...g, name }));

  const addGroup = () => {
    setTouched(true);
    setGroups((prev) => {
      const next = [...prev, newGroup()];
      setAutofocusGroupIdx(next.length - 1);
      setLiveMsg(`Rule group ${next.length} added`);
      return next;
    });
  };

  const duplicateGroup = (idx: number) => {
    setTouched(true);
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
    setTouched(true);
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
  // An imported binder is a physical binder too: it keeps the page settings
  // and trade flag chosen on the import screen.
  const binderLayout = { pocketSize, doubleSided, fixedCapacity, tradeable };

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
                binderLayout,
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
          binderLayout,
        });
      }
      setEditingBinder(null);
    } catch (err) {
      setErrorMsg(userMessage(err, "Couldn't save the binder. Try again."));
    } finally {
      setSaving(false);
      setLoading(false);
      setImportProgress(null);
    }
  };

  const handleSave = async () => {
    setTouched(true);
    const isImportMode = step === 'import' && isNew;
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
      // Drop a stale depth when the sort chain no longer supports it — the
      // Page-breaks control is hidden at sorts.length <= 1, so a leftover
      // depth would persist invisibly (materialize also clamps defensively).
      pageBreakDepth: sorts.length > 1 && pageBreakDepth > 1 ? pageBreakDepth : undefined,
      packSections: packSections || undefined,
    };

    // Rules binder (or editing an existing one): synchronous create/update.
    if (existing || !isImportMode) {
      setSaving(true);
      setErrorMsg(null);
      try {
        const id = existing ? existing.id : createBinder(input).id;
        if (existing) updateBinder(id, input);
        if (placeAboveId) moveBinderAbove(id, placeAboveId);
        setEditingBinder(null);
      } catch (err) {
        setErrorMsg(userMessage(err, "Couldn't save the binder. Try again."));
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

  const allGroupsEmpty = areAllGroupsEmpty(groups);
  // A brand-new, untouched binder is not "a binder with no conditions" yet —
  // it is a blank form. The warning waits until the user has authored
  // something (a name, a rule edit, or a save attempt).
  const showEmptyWarning = allGroupsEmpty && (!isNew || touched || name.trim() !== '');
  const capacity = fixedCapacity ?? 0;
  // Suppress over-capacity warning when filters are empty — an unfiltered binder
  // would match every card by definition, which is never what the warning is
  // trying to flag.
  const overCapacity = fixedCapacity !== null && !allGroupsEmpty && binderMatchCount > capacity;

  const isImportBatch = step === 'import' && importFiles_.length > 0;
  const close = () => setEditingBinder(null);

  // The earliest binder (in waterfall order) that takes this binder's cards —
  // what "Move above" re-seats it ahead of.
  const firstCatcher = (() => {
    if (!effectiveLanding || effectiveLanding.caughtBy.length === 0) return null;
    const ids = new Set(effectiveLanding.caughtBy.map((c) => c.binderId));
    return [...binders].sort((a, b) => a.position - b.position).find((b) => ids.has(b.id)) ?? null;
  })();
  const placeAbove = placeAboveId ? binders.find((b) => b.id === placeAboveId) : undefined;

  const pickStart = (start: BinderStart) => {
    if (start.kind === 'import') {
      setStep('import');
      return;
    }
    const previous = STARTER_LABELS.has(name.trim());
    if (start.kind === 'template') {
      const tpl = start.template;
      setGroups([{ filter: { ...(tpl.filter ?? {}) } }]);
      // Name the binder after its template unless the user already named it.
      if (!name.trim() || previous) setName(tpl.label);
      setRevealSetsSignal(tpl.revealSets ? 1 : 0);
    } else {
      setGroups([newGroup()]);
      if (previous) setName('');
      setRevealSetsSignal(0);
    }
    setStep('rules');
  };

  const orderSummary =
    sorts
      .map((s) => {
        const label = SORT_FIELDS.find((f) => f.value === s.field)?.label ?? s.field;
        return `${label} (${sortDirectionLabel(s.field, s.dir)})`;
      })
      .join(', then ') +
    (sectionMode === 'group' && groups.length >= 2 ? ' · sections by rule' : '');

  const pagesSummary = [
    `${pocketSize}-pocket`,
    doubleSided ? 'both sides' : 'one side',
    sectionMode !== 'group' ? PACK_LABEL[String(packSections)] : null,
    fixedCapacity === null ? 'no limit' : `${fixedCapacity.toLocaleString()} cards`,
  ]
    .filter(Boolean)
    .join(' · ');

  const pagesSettings = (
    <>
      <Field label="Pockets per page">
        <SegmentedControl
          ariaLabel="Pockets per page"
          value={pocketSize}
          options={([4, 9, 12] as const).map((n) => ({
            value: n,
            ariaLabel: `${n}-pocket`,
            label: (
              <>
                <PocketGlyph pockets={n} />
                {n}
              </>
            ),
          }))}
          onChange={(next) => {
            setFixedCapacity((prev) =>
              prev !== null && prev === defaultFixedCapacity(pocketSize, doubleSided)
                ? defaultFixedCapacity(next, doubleSided)
                : prev
            );
            setPocketSize(next);
          }}
        />
      </Field>
      <SwitchRow
        label="Double-sided sheets"
        hint="The back of each sheet counts as its own page."
        checked={doubleSided}
        onChange={(next) => {
          setFixedCapacity((prev) =>
            prev !== null && prev === defaultFixedCapacity(pocketSize, doubleSided)
              ? defaultFixedCapacity(pocketSize, next)
              : prev
          );
          setDoubleSided(next);
        }}
      />
      <Field
        label="Capacity"
        hint={
          fixedCapacity === null
            ? 'The binder grows with its cards.'
            : 'Cards past the limit still show, flagged as over capacity.'
        }
      >
        <div className="binder-capacity">
          <SegmentedControl
            ariaLabel="Capacity"
            value={fixedCapacity === null ? 'none' : 'fixed'}
            options={[
              { value: 'none', label: 'No limit' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={(v) =>
              setFixedCapacity(v === 'fixed' ? defaultFixedCapacity(pocketSize, doubleSided) : null)
            }
          />
          {fixedCapacity !== null && (
            <span className="binder-capacity-count">
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
                className="rule-number-input"
              />
              <span>
                cards · about {Math.ceil(fixedCapacity / pocketSize).toLocaleString()}{' '}
                {Math.ceil(fixedCapacity / pocketSize) === 1 ? 'page' : 'pages'}
              </span>
            </span>
          )}
        </div>
      </Field>
    </>
  );

  return (
    <>
      {/* The shared Modal: focus trap and restore, exit animation, hardware
          back, the overlay-layer Escape stack. `modal-backdrop--sheet` makes
          it a bottom sheet on a phone. `dismissable={!saving}` stops a stray
          backdrop tap from tearing the editor down mid-import. */}
      <Modal
        onClose={close}
        className="modal binder-editor"
        backdropClassName="modal-backdrop--sheet"
        labelledBy="binder-editor-title"
        dismissable={!saving}
      >
        <div className="modal-header binder-editor-header">
          {step === 'start' ? (
            <h2 id="binder-editor-title">New binder</h2>
          ) : (
            <>
              {isNew && (
                <button
                  type="button"
                  className="binder-editor-back"
                  onClick={() => setStep('start')}
                  disabled={saving}
                  aria-label="Back to ways to start"
                >
                  <ChevronLeft width={18} height={18} strokeWidth={2} aria-hidden />
                </button>
              )}
              {isImportBatch ? (
                <h2 id="binder-editor-title">
                  {importFiles_.length} {importFiles_.length === 1 ? 'binder' : 'binders'} from
                  files
                </h2>
              ) : (
                <>
                  <h2 id="binder-editor-title" className="sr-only">
                    {existing ? 'Edit binder' : 'New binder'}
                  </h2>
                  <ColorDot value={color} onChange={setColor} />
                  <input
                    id="binder-editor-name"
                    className="binder-editor-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name this binder"
                    aria-label="Binder name"
                    // Picking a start unmounts the tile that had focus; the name is
                    // the next thing to confirm, so focus lands there.
                    autoFocus
                  />
                </>
              )}
            </>
          )}
          <button className="modal-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body binder-editor-body">
          {step === 'start' && <BinderStartChooser cards={cards} onPick={pickStart} />}

          {step === 'rules' && (
            <>
              <section className="binder-editor-cards">
                <h3 className="form-section-heading">
                  Cards <InfoTip label="how a card lands here" text={CARDS_TIP} wide />
                </h3>

                {routingMode === 'manual' && existing && (
                  <div className="manual-mode-banner">
                    <p>
                      This binder uses manual mode. Only pinned cards appear; its rules are paused.
                    </p>
                    <Button onClick={() => setRoutingMode('rules')}>Switch to rules</Button>
                  </div>
                )}

                {isNew && editingBinderSeed?.flagged && editingBinderSeed.flagged.length > 0 && (
                  <p className="binder-seed-note">
                    Some filters weren&apos;t carried over or match differently in a binder:{' '}
                    {editingBinderSeed.flagged
                      .map((key) => {
                        if (key === 'condition') return 'condition';
                        if (key === 'binder') return 'binder membership';
                        if (key === 'color') return 'color (binders match exact color identity)';
                        return key;
                      })
                      .join(', ')}
                    .
                  </p>
                )}

                <div className={routingMode === 'manual' ? 'binder-editor-paused' : undefined}>
                  <FilterGroupList
                    groups={groups}
                    cards={taggedCards}
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
                    revealSetsSignal={revealSetsSignal}
                  />
                </div>

                {routingMode === 'rules' && (
                  <div className="binder-editor-switches">
                    <SwitchRow
                      label="Include cards in decks and cubes"
                      hint="Off hides them here until they're released. Pins stay put."
                      checked={showDeckAllocated}
                      onChange={setShowDeckAllocated}
                    />
                    <SwitchRow
                      label="Keep every printing together"
                      hint="A matching card brings its other copies along, unless another binder already holds them."
                      checked={keepPrintingsTogether}
                      onChange={setKeepPrintingsTogether}
                    />
                  </div>
                )}

                {placeAbove && (
                  <p className="binder-editor-note">
                    Moves above <strong>{placeAbove.name}</strong> when you save.{' '}
                    <Button variant="link" onClick={() => setPlaceAboveId(null)}>
                      Keep its place
                    </Button>
                  </p>
                )}

                {effectiveLanding &&
                  effectiveLanding.matches > 0 &&
                  effectiveLanding.lands === 0 &&
                  !placeAbove && (
                    <div className="warn-banner binder-editor-warn">
                      <span>
                        Every matching card already lands in{' '}
                        {formatCaughtBy(effectiveLanding.caughtBy, 'a binder above this one')}, so
                        this binder will be empty.
                      </span>
                      {firstCatcher && (
                        <Button onClick={() => setPlaceAboveId(firstCatcher.id)}>
                          Move above {firstCatcher.name}
                        </Button>
                      )}
                    </div>
                  )}

                {showEmptyWarning && (
                  <div className="warn-banner binder-editor-warn">
                    This binder has no conditions, so it takes every card the binders above leave
                    over. Add a condition, or move it near the bottom of your binder list.
                  </div>
                )}

                {overCapacity && (
                  <div className="warn-banner binder-editor-warn">
                    {binderMatchCount.toLocaleString()} cards match, but the capacity is{' '}
                    {capacity.toLocaleString()}. The extra{' '}
                    {(binderMatchCount - capacity).toLocaleString()} still show, flagged as over
                    capacity.
                  </div>
                )}

                <div className="sr-only" role="status" aria-live="polite">
                  {liveMsg}
                </div>
              </section>

              <div className="binder-editor-settings">
                <Disclosure title="Order" summary={orderSummary}>
                  <SortEditor
                    sorts={sorts}
                    valueOrders={sortValueOrders}
                    onSortsChange={setSorts}
                    onValueOrdersChange={setSortValueOrders}
                  />
                  {groups.length >= 2 ? (
                    <Field label="Section headers come from">
                      <SegmentedControl
                        ariaLabel="Section headers come from"
                        value={sectionMode}
                        options={[
                          { value: 'sort', label: 'The first sort' },
                          { value: 'group', label: 'Rules' },
                        ]}
                        onChange={setSectionMode}
                      />
                    </Field>
                  ) : (
                    <p className="form-field-hint">
                      With two or more rules, section headers can follow the rules instead.
                    </p>
                  )}
                </Disclosure>
                <Disclosure title="Pages" summary={pagesSummary}>
                  {pagesSettings}
                  {sectionMode !== 'group' && (
                    <Field label="Page filling">
                      <ChoiceList
                        ariaLabel="Page filling"
                        value={packSections}
                        options={[
                          {
                            value: false,
                            label: PACK_LABEL.false,
                            hint: 'Every section starts on a fresh page.',
                          },
                          {
                            value: true,
                            label: PACK_LABEL.true,
                            hint: 'Sections share a page when they fit whole. None is split.',
                          },
                          {
                            value: 'continuous',
                            label: PACK_LABEL.continuous,
                            hint: 'No empty pockets. Adding a card later shifts everything after it, so it suits closed sets like a Secret Lair drop.',
                          },
                        ]}
                        onChange={setPackSections}
                      />
                    </Field>
                  )}
                  {sectionMode !== 'group' &&
                    (sorts.length > 1 ? (
                      <Field
                        label="Page breaks"
                        hint={
                          pageBreakDepth <= 1
                            ? 'Each section header starts a new page; deeper sorts order cards within it.'
                            : `Each ${pageBreakDepth === 2 ? 'second' : `level-${pageBreakDepth}`} sort group starts its own page. Empty pockets are accepted.`
                        }
                      >
                        <SelectMenu
                          ariaLabel="Page breaks"
                          value={pageBreakDepth}
                          onChange={(v) => setPageBreakDepth(v as number)}
                          options={Array.from({ length: sorts.length }, (_, i) => ({
                            value: i + 1,
                            label: i === 0 ? 'Section headers only' : `First ${i + 1} sort levels`,
                          }))}
                        />
                      </Field>
                    ) : (
                      <p className="form-field-hint">
                        Add a second sort in Order to break pages at a deeper level.
                      </p>
                    ))}
                </Disclosure>
              </div>

              <SwitchRow
                label="Offer for trade"
                hint="Cards here can appear on a game night's trade board when you opt in."
                checked={tradeable}
                onChange={setTradeable}
              />
            </>
          )}

          {step === 'import' && isNew && (
            <>
              <section
                className={`binder-import-drop file-dropzone${importDragging ? ' is-dragging' : ''}`}
                {...importDropProps}
              >
                {importDragging && (
                  <div className="file-drop-overlay" aria-hidden="true">
                    <div className="file-drop-message">Drop files, one binder each</div>
                  </div>
                )}
                {importFiles_.length > 0 ? (
                  <>
                    <ul className="binder-import-rows">
                      {importFiles_.map((f, i) => (
                        <li key={f.name} className="binder-import-row">
                          <ColorDot
                            value={binderDrafts[i]?.color ?? PRESET_COLORS[0].hex}
                            onChange={(hex) =>
                              setBinderDrafts((ds) =>
                                ds.map((d, idx) => (idx === i ? { ...d, color: hex } : d))
                              )
                            }
                            label={`Binder color for ${f.name}`}
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
                    {importStageNote && <p className="binder-editor-note">{importStageNote}</p>}
                  </>
                ) : (
                  <textarea
                    className="paste-textarea import-binder-textarea"
                    value={importPasteText}
                    onChange={(e) => setImportPasteText(e.target.value)}
                    placeholder={'1 Llanowar Elves\n1 Birds of Paradise\n4 Lightning Bolt\n…'}
                    aria-label="Card list"
                    disabled={saving}
                  />
                )}
                <div className="binder-import-actions">
                  <Button onClick={() => importFileRef.current?.click()} disabled={saving}>
                    {importFiles_.length > 0 ? 'Add more files' : 'Upload CSV files'}
                  </Button>
                  {importFiles_.length > 0 ? (
                    <Button
                      variant="link"
                      onClick={() => applyStagedFiles([], importFiles_)}
                      disabled={saving}
                    >
                      Clear
                    </Button>
                  ) : (
                    <span className="binder-editor-note">
                      or drop them here. Each file becomes its own binder.
                    </span>
                  )}
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

              <SwitchRow
                label="Mark all as proxies"
                hint="Proxies count as owned but carry no market value. What you paid still counts."
                checked={importAsProxies}
                onChange={setImportAsProxies}
                disabled={saving}
              />

              <div className="binder-editor-settings">
                <Disclosure
                  title="Pages"
                  summary={
                    isImportBatch && importFiles_.length > 1
                      ? `${pagesSummary} · applies to all ${importFiles_.length}`
                      : pagesSummary
                  }
                >
                  {pagesSettings}
                </Disclosure>
              </div>

              <SwitchRow
                label="Offer for trade"
                hint="Cards here can appear on a game night's trade board when you opt in."
                checked={tradeable}
                onChange={setTradeable}
                disabled={saving}
              />
            </>
          )}

          {errorMsg && <div className="error-banner">{errorMsg}</div>}
        </div>

        {step !== 'start' && (
          <div className="modal-footer binder-editor-footer">
            <FooterResult
              step={step}
              routingMode={routingMode}
              pinned={existing?.pinnedCopyIds?.length ?? 0}
              landing={effectiveLanding}
              fileCount={importFiles_.length}
            />
            <Button onClick={close} disabled={saving} className="binder-editor-cancel">
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving
                ? importProgress && importProgress.totalChunks > 1
                  ? importProgress.totalFiles && importProgress.totalFiles > 1
                    ? `File ${importProgress.fileIndex}/${importProgress.totalFiles} · batch ${importProgress.chunkIndex}/${importProgress.totalChunks}…`
                    : `Importing batch ${importProgress.chunkIndex} of ${importProgress.totalChunks}…`
                  : 'Saving…'
                : existing
                  ? 'Save changes'
                  : step === 'import'
                    ? isImportBatch && importFiles_.length > 1
                      ? `Create ${importFiles_.length} binders`
                      : 'Create and import'
                    : 'Create binder'}
            </Button>
          </div>
        )}
      </Modal>

      {collisionPrompt && (
        <Modal
          onClose={() => setCollisionPrompt(null)}
          className="modal"
          labelledBy="binder-collision-title"
        >
          <h2 className="choice-dialog-title" id="binder-collision-title">
            Some binder names need a decision
          </h2>
          <ul className="choice-dialog-body" style={{ paddingLeft: 'var(--space-4)' }}>
            {collisionPrompt.map((c) => {
              const facts: string[] = [];
              if (c.count > 1) facts.push(`${c.count} staged files share this name`);
              if (c.existing) facts.push('already matches a binder you have');
              return (
                <li key={c.name}>
                  <strong>"{c.name}"</strong>
                  {facts.length > 0 ? `: ${facts.join('. ')}.` : ''}
                </li>
              );
            })}
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
                    ? ' Existing same-named binders are left alone.'
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
                Keep one binder per file. You'll get additional binders with the same name
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
        </Modal>
      )}
    </>
  );
}

// cleanFilter moved to ../lib/clean-filter (pure, unit-tested, coverage-gated).

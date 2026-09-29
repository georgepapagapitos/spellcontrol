import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, X } from 'lucide-react';
import { fetchTypeSuggestions, fetchOracleSuggestions } from '../lib/scryfall-catalog';
import { importFile, importText, type ImportProgressCallback } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { mergeStagedFiles, stagedFilesNotice, stripExtension } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { NEW_BINDER_DEFAULT_SORTS, SORT_FIELDS, SORT_PRESETS } from '../lib/sorting';
import { useAnchoredPanel } from '../lib/use-anchored-panel';
import { SortEditor } from './SortEditor';
import { SortPresetChips } from './SortPresets';
import { focusFirstSortField } from '../lib/sort-field-focus';
import { sortOrderSummaryLabel } from '../lib/sort-order-label';
import { areAllGroupsEmpty } from '../lib/rules';
import {
  countEffectiveLanding,
  formatCaughtBy,
  materializeDraftPreview,
  type EffectiveLandingCounts,
} from '../lib/binder-counts';
import { useCardsWithTags, groupsUseTags } from '../lib/card-tags';
import { useCardsWithSpareCopies, groupsUseSpareCopies } from '../lib/spare-copies';
import { useBinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { useMediaQuery } from '../lib/use-media-query';
import { cleanFilter } from '../lib/clean-filter';
import {
  formatPagesSummary,
  PACK_LABEL,
  leaveRoomOf,
  leaveRoomPockets,
  sheetCount,
  sheetsPhrase,
  type LeaveRoom,
} from '../lib/binder-pages-summary';
import {
  cardsNeedVolumes,
  fitButtonLabel,
  hasMultipleVolumes,
  noFitMessage,
  smallestFittingCapacity,
  standardBinderSizes,
  volumePageRange,
  volumeSpine,
  volumesFor,
} from '../lib/binder-volumes';
import { Modal } from './Modal';
import { SelectMenu } from './SelectMenu';
import { ColorPicker } from './ColorPicker';
import { PRESET_COLORS, pickRandomPresetColor } from '../lib/preset-colors';
import { InfoTip } from './InfoTip';
import { FilterGroupList, cloneChips, validateRanges } from './FilterGroupEditor';
import {
  BinderStartChooser,
  startBinderName,
  CHOOSER_START_LABELS,
  type BinderStart,
} from './BinderStartChooser';
import { colorPickFilter } from '../lib/binder-templates';
import { BinderLadder } from './BinderLadder';
import { BinderEditorPreview } from './BinderEditorPreview';
import { BinderEditorPreviewStrip } from './BinderEditorPreviewStrip';
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
import { Button, IconButton } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
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

const STARTER_LABELS = new Set(CHOOSER_START_LABELS);

/** A sort field's picker label ("Set"), for copy that names the field. */
const sortFieldLabel = (field: string | undefined): string =>
  SORT_FIELDS.find((f) => f.value === field)?.label ?? 'group';

/** The page's pocket grid, drawn: 2×2, 3×3 or 4×3 card-shaped pockets. */
function PocketGlyph({ pockets }: { pockets: PocketSize }) {
  const cols = pockets === 4 ? 2 : pockets === 12 ? 4 : 3;
  return (
    <span
      className="binder-pocket-glyph"
      style={{ '--pocket-cols': cols } as CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: pockets }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** What a binder buyer calls each pocket count: the word under the tile. */
const POCKET_TILE_CAPTION: Record<PocketSize, string> = {
  4: 'Toploader pages',
  9: 'Most binders',
  12: 'Zip binders',
};

/** One pocket-count tile: the grid, the number and what it's called. It is
 *  a `SegmentedControl` option's label, so the tile stays a native radio. */
function PocketTileLabel({ pockets }: { pockets: PocketSize }) {
  return (
    <span className="binder-pocket-tile">
      <PocketGlyph pockets={pockets} />
      <span className="binder-pocket-tile-n">{pockets}</span>
      <span className="binder-pocket-tile-caption">{POCKET_TILE_CAPTION[pockets]}</span>
    </span>
  );
}

/**
 * Two tiny 9-pocket pages per page-filling mode (mockup 06), so the three are
 * seen, not parsed. Decorative (`aria-hidden`): the option's text names it.
 * Each letter is one pocket: a, b and c are three sections in turn, e is an
 * empty pocket. Hand-drawn to show the rule, not the user's cards; the
 * preview column shows those.
 */
const FILL_PATTERNS: Record<'false' | 'true' | 'continuous', [string, string]> = {
  false: ['aaaaeeeee', 'bbbeeeeee'],
  true: ['aaaabbbee', 'ccccceeee'],
  continuous: ['aaaabbbcc', 'ccceeeeee'],
};

function FillPictogram({ mode }: { mode: 'false' | 'true' | 'continuous' }) {
  return (
    <span className="binder-fill-pic" aria-hidden="true">
      {FILL_PATTERNS[mode].map((page, pi) => (
        <span key={pi} className="binder-fill-pic-page">
          {page.split('').map((slot, si) => (
            <i key={si} className={`binder-fill-pic-pocket--${slot}`} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** "Leave room" choices, in the control's order. */
const LEAVE_ROOM_OPTIONS: { value: LeaveRoom; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'half', label: 'Half a page' },
  { value: 'full', label: 'A full page' },
];

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
      <IconButton
        className="binder-color-dot"
        ref={triggerRef}
        style={{ '--dot-color': value } as CSSProperties}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        label={label}
        icon={<ChevronDown width={12} height={12} strokeWidth={2} />}
      />
      {open &&
        panelStyle &&
        createPortal(
          <Surface
            as="div"
            variant="popover"
            ref={panelRef}
            className="binder-color-panel"
            role="dialog"
            aria-label={label}
            style={panelStyle}
          >
            <ColorPicker value={value} onChange={onChange} ariaLabel={label} />
          </Surface>,
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
  // "Leave room" (BinderDef.sparePockets, E473), held as the choice the
  // control offers so the same room survives a pocket-size change; the pocket
  // count is derived at save time (`leaveRoomPockets`).
  const [leaveRoom, setLeaveRoom] = useState<LeaveRoom>('none');
  // "Other…" in Holds: a size the chips don't sell. Its own state, because a
  // custom number can equal a chip (the default 360 on a double-sided
  // 9-pocket binder), and picking Other must still open the number field.
  const [holdsOther, setHoldsOther] = useState(false);
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
  // The Order section's chips + chain, so "Choose fields" can reach the chain.
  const orderRef = useRef<HTMLDivElement>(null);
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
  // Starts closed, not at `isOpen`: Layout loads this editor lazily on its
  // first open, so it can mount already open and must still seed its form.
  const [prevIsOpen, setPrevIsOpen] = useState(false);
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
        setHoldsOther(
          existing.fixedCapacity != null &&
            !standardBinderSizes(existing.pocketSize ?? 9).includes(existing.fixedCapacity)
        );
        setShowDeckAllocated(existing.hideDeckAllocated !== false);
        setKeepPrintingsTogether(!!existing.keepPrintingsTogether);
        setSectionMode(existing.sectionMode ?? 'sort');
        setPageBreakDepth(existing.pageBreakDepth ?? 1);
        // A deeper page break wins over page sharing in the engine
        // (`buildSections` only packs at depth 1), so a stored binder with
        // both shows what it really does: a new page per section.
        const breaksDeeper =
          existing.sectionMode !== 'group' &&
          Math.min(existing.pageBreakDepth ?? 1, existing.sorts.length) > 1;
        setPackSections(
          breaksDeeper
            ? false
            : existing.packSections === 'continuous'
              ? 'continuous'
              : !!existing.packSections
        );
        setLeaveRoom(leaveRoomOf(existing.sparePockets, existing.pocketSize ?? 9));
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
        setHoldsOther(false);
        setShowDeckAllocated(true);
        setKeepPrintingsTogether(false);
        setSectionMode('sort');
        setPageBreakDepth(1);
        setPackSections(false);
        setLeaveRoom('none');
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

  // BinderPage's inputs, so the other binders route here the way they do on
  // their own pages: a tag-rule binder above the draft needs tagged cards too,
  // or it catches nothing and its cards read as landing in the draft (a new
  // "$1+" binder said 30 land here out of a 27-card pile). Tags are added
  // again for the draft's own rules, since it isn't committed yet. Feeds the
  // landing counts below and the per-group badge in FilterGroupList.
  const layout = useBinderLayoutInputs();
  const taggedCards = useCardsWithTags(layout.cards, groupsUseTags(groups));
  // Same reasoning as tags: the draft's OWN "Spare copies" rule needs the
  // decoration too, even before any saved binder uses the field.
  const draftCards = useCardsWithSpareCopies(
    taggedCards,
    layout.allocatedCopyIds,
    groupsUseSpareCopies(groups)
  );
  // `groups` changes on every keystroke inside a condition; the reads below
  // scan the whole collection (a real account runs 11k+ cards), so feeding
  // them live `groups` made typing itself the janky part — the character
  // waited behind a 200ms+ scan before it could paint (E493). `groups` stays
  // live everywhere it drives what's actually being edited (FilterGroupList's
  // rows/chips); only these read-side counts lag the debounce.
  const debouncedGroups = useDebouncedValue(groups, 200);
  // Where the waterfall actually seats this binder's cards, not just how many
  // match its own rules — substitutes the draft into the real binder list (in
  // position order) so a binder placed behind a broader one shows the truth:
  // it may match plenty of cards and still land none of them. Skipped for
  // manual-mode binders, which don't route by rules at all — and while closed,
  // where it was a full binder materialisation on every signed-in page (E276).
  const effectiveLanding = useMemo(() => {
    if (!isOpen || routingMode === 'manual') return null;
    return countEffectiveLanding(
      draftCards,
      binders,
      {
        id: existing?.id ?? null,
        groups: debouncedGroups,
        keepPrintingsTogether,
        mode: routingMode,
        placeAboveId,
        name,
        color,
      },
      layout
    );
  }, [
    layout,
    draftCards,
    binders,
    debouncedGroups,
    keepPrintingsTogether,
    routingMode,
    existing?.id,
    isOpen,
    placeAboveId,
    name,
    color,
  ]);

  // What the page settings actually do, which is what the Pages controls show
  // and what Save writes. Sections come from the rules only with two or more
  // rules. A deeper page break and "Leave room" both refine "each section
  // starts a new page", so sharing pages turns both off (and the controls
  // say why) instead of storing a setting the engine would ignore.
  const rulesSections = sectionMode === 'group' && groups.length >= 2;
  const breakDepth =
    !rulesSections && packSections === false
      ? Math.min(pageBreakDepth, Math.max(sorts.length, 1))
      : 1;
  const roomPockets = packSections === false ? leaveRoomPockets(leaveRoom, pocketSize) : 0;

  // The editor's own layout settings, in exactly the shape Save will persist
  // (BinderInput) — one function feeds both, so the live preview can never
  // show a different binder than the one Save writes. Debounced before it
  // reaches the (much heavier) full materialize pass below: a keystroke in a
  // condition must never wait on a page/section rebuild over the collection.
  const buildDraftInput = (): BinderInput => ({
    name: name.trim(),
    position: existing?.position ?? 0,
    filterGroups: groups.map((g) => ({
      ...(g.name?.trim() ? { name: g.name.trim() } : {}),
      filter: cleanFilter(g.filter),
    })),
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
    sectionMode: rulesSections ? 'group' : undefined,
    pageBreakDepth: breakDepth > 1 ? breakDepth : undefined,
    packSections: packSections || undefined,
    sparePockets: roomPockets || undefined,
  });

  // Deps are the primitive fields `buildDraftInput` reads, not the function
  // itself — it's a fresh closure every render (same pattern as
  // `effectiveLanding` above), so listing it would defeat
  // the memo and rebuild the draft def on every unrelated re-render.
  const draftInput = useMemo(
    () => buildDraftInput(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      name,
      groups,
      sorts,
      sortValueOrders,
      pocketSize,
      doubleSided,
      fixedCapacity,
      color,
      routingMode,
      showDeckAllocated,
      keepPrintingsTogether,
      tradeable,
      sectionMode,
      pageBreakDepth,
      packSections,
      leaveRoom,
      existing?.position,
    ]
  );
  const debouncedDraftInput = useDebouncedValue(draftInput, 200);
  // The editor stays mounted while closed, so the debounced draft still holds
  // whatever it last saw (a blank form, or the previous binder) when it opens.
  // Until the debounce first settles on the opened binder, the preview reads
  // the live draft, so it never opens on the wrong pages or capacity. Called
  // after the draft's own debounce, so on open its timer fires first.
  const previewSettled = useDebouncedValue(isOpen && step === 'rules', 200);
  const previewInput = previewSettled ? debouncedDraftInput : draftInput;

  const hydrating = useCollectionStore((s) => s.hydrating);
  const draftPreview = useMemo(() => {
    if (!isOpen || step !== 'rules') return null;
    return materializeDraftPreview(
      draftCards,
      binders,
      existing,
      previewInput,
      placeAboveId,
      layout
    );
  }, [isOpen, step, draftCards, binders, existing, previewInput, placeAboveId, layout]);

  const phone = useMediaQuery('(max-width: 599px)');
  // The Holds control, so "Use a <size>-card binder" can hand focus to it.
  const holdsRef = useRef<HTMLDivElement>(null);

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

    // ⚠️ Built by `buildDraftInput()` above — the SAME function the live
    // preview reads, so what Save writes and what the preview showed can
    // never diverge. Every persistable BinderDef field must be listed there
    // explicitly: a field omitted is silently dropped on save (the editor
    // looks fine, but the reloaded binder loses it). Add new fields there
    // when extending BinderDef. (Same trap that hit BinderFilter via
    // cleanFilter.)
    const input: BinderInput = {
      ...buildDraftInput(),
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
        // A new binder lands wherever its position puts it, often below the
        // fold, so creation confirms itself (STYLE_GUIDE § Verbs: feedback).
        // An edit happened in front of the user and needs none.
        if (!existing) toast.show({ message: `Created ${input.name}`, tone: 'success' });
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
  // Last in line, an empty binder is the catch-all the Uncategorized sheet
  // offers ("Everything else"): worth saying what it does, not a mistake. Above
  // other binders it takes the cards they were meant to get, which is.
  const sitsLast =
    !placeAboveId &&
    (isNew ||
      binders.every((b) => b.id === existing?.id || b.position < (existing?.position ?? 0)));
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
      const filter =
        tpl.colorPick && start.color ? colorPickFilter(start.color) : (tpl.filter ?? {});
      setGroups([{ filter: { ...filter } }]);
      // Name the binder after its template (or its picked color) unless the
      // user already named it.
      const label = startBinderName(start);
      if (label && (!name.trim() || previous)) setName(label);
      setRevealSetsSignal(tpl.revealSets ? 1 : 0);
      // Every grouped tile promises an order (E495) — seed it now so the
      // binder created from it actually lands on the page count the tile
      // showed, not the color-sort default every OTHER new binder opens on.
      const preset = SORT_PRESETS.find((p) => p.id === tpl.sortPreset);
      if (preset) setSorts(preset.sorts);
      if (tpl.tradeable) setTradeable(true);
    } else if (start.kind === 'catch-all') {
      setGroups([newGroup()]);
      if (!name.trim() || previous) setName('Everything else');
      setRevealSetsSignal(0);
    } else {
      setGroups([newGroup()]);
      if (previous) setName('');
      setRevealSetsSignal(0);
    }
    setStep('rules');
  };

  // A stored chain matching a named order (E491) shows that name here, and on
  // the sort pill everywhere else this binder's order appears — anything else
  // is the chain spelled out in words ("Rarity, then price").
  const orderSummary = sortOrderSummaryLabel(sorts) + (rulesSections ? ' · sections by rule' : '');

  // The draft's own volumes, from the SAME materialize pass the preview
  // column already computes (`draftPreview`), never a second one. That pass
  // is debounced, so a capacity edit is only answered once the preview has
  // caught up with it: until then the old answer would be labelled with the
  // new size. `volumesFor` needs an unfiltered pass, which the preview is.
  const previewCurrent = !!draftPreview && draftPreview.def.fixedCapacity === fixedCapacity;
  const draftVolumes = draftPreview ? volumesFor(draftPreview) : null;
  const overCapacityVolumes =
    previewCurrent && hasMultipleVolumes(draftVolumes) ? draftVolumes : null;
  // Page-based, never a raw card count: see smallestFittingCapacity's doc for
  // why that lies once sections start fresh pages.
  const fitCapacity =
    draftPreview && overCapacityVolumes
      ? smallestFittingCapacity(draftPreview.totalPages, draftPreview.effectivePocketSize)
      : null;

  const breakField = breakDepth > 1 ? sortFieldLabel(sorts[breakDepth - 1]?.field) : null;
  const pagesSummary = formatPagesSummary({
    pocketSize,
    doubleSided,
    fixedCapacity,
    packSections,
    sparePockets: roomPockets,
    breakField,
    volumes: overCapacityVolumes,
  });

  // Holds: the sizes a binder is sold in at this pocket count, plus No limit
  // and Other…. Exactly one is always selected.
  const holdsSizes = standardBinderSizes(pocketSize);
  const holdsValue: string =
    fixedCapacity === null
      ? 'none'
      : holdsOther || !holdsSizes.includes(fixedCapacity)
        ? 'other'
        : String(fixedCapacity);

  // "Use a <size>-card binder" is a draft edit like any other (applied on
  // Save, so no toast). The answer that held the button goes away once the
  // preview catches up, so focus moves to the size it picked and the change
  // is announced, instead of dropping to the page.
  const applyFit = (size: number) => {
    setHoldsOther(false);
    setFixedCapacity(size);
    setLiveMsg(`Holds ${size.toLocaleString()} cards, so it fits one binder.`);
    window.setTimeout(() => {
      holdsRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    }, 0);
  };

  // Keeps the Holds choice on the same tier when the pocket size changes (a
  // 360-card 9-pocket binder becomes the 480-card 12-pocket one), and the
  // untouched default capacity on the new default.
  const setPocketSizeKeepingHolds = (next: PocketSize) => {
    setFixedCapacity((prev) => {
      if (prev === null) return null;
      if (prev === defaultFixedCapacity(pocketSize, doubleSided))
        return defaultFixedCapacity(next, doubleSided);
      const tier = holdsOther ? -1 : holdsSizes.indexOf(prev);
      return tier >= 0 ? standardBinderSizes(next)[tier] : prev;
    });
    setPocketSize(next);
  };

  const pagesSettings = (
    <>
      <Field label="Pockets per page">
        <div className="binder-pocket-tiles">
          <SegmentedControl
            ariaLabel="Pockets per page"
            value={pocketSize}
            options={([4, 9, 12] as const).map((n) => ({
              value: n,
              ariaLabel: `${n}-pocket, ${POCKET_TILE_CAPTION[n]}`,
              label: <PocketTileLabel pockets={n} />,
            }))}
            onChange={setPocketSizeKeepingHolds}
          />
        </div>
      </Field>
      <Field label="Sides" hint="Double-sided sheets hold twice as much.">
        <SegmentedControl
          ariaLabel="Sides"
          value={doubleSided}
          options={[
            { value: false, label: 'One side' },
            { value: true, label: 'Both sides' },
          ]}
          onChange={(next) => {
            setFixedCapacity((prev) =>
              prev !== null && prev === defaultFixedCapacity(pocketSize, doubleSided)
                ? defaultFixedCapacity(pocketSize, next)
                : prev
            );
            setDoubleSided(next);
          }}
        />
      </Field>
      <Field
        label="Holds"
        hint={
          fixedCapacity === null
            ? 'The binder grows with its cards.'
            : 'Past this, the cards go on into another volume.'
        }
      >
        <div className="binder-holds" ref={holdsRef}>
          <SegmentedControl
            ariaLabel="Holds"
            fill
            value={holdsValue}
            options={[
              { value: 'none', label: 'No limit' },
              ...holdsSizes.map((size) => ({
                value: String(size),
                label: size.toLocaleString(),
                ariaLabel: `${size.toLocaleString()} cards`,
              })),
              { value: 'other', label: 'Other…' },
            ]}
            onChange={(v) => {
              setHoldsOther(v === 'other');
              if (v === 'none') setFixedCapacity(null);
              else if (v === 'other')
                setFixedCapacity((prev) => prev ?? defaultFixedCapacity(pocketSize, doubleSided));
              else setFixedCapacity(Number(v));
            }}
          />
          {fixedCapacity !== null && (
            <p className="binder-holds-count">
              {holdsValue === 'other' ? (
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
              ) : (
                <span className="binder-holds-count-n">{fixedCapacity.toLocaleString()}</span>
              )}
              <span>
                cards · {sheetsPhrase(sheetCount(fixedCapacity, pocketSize, doubleSided))}
              </span>
            </p>
          )}
        </div>
      </Field>
      {overCapacityVolumes && fixedCapacity !== null && (
        <div className="binder-editor-volumes-answer">
          <p className="binder-editor-volumes-fact">
            {cardsNeedVolumes(overCapacityVolumes, fixedCapacity)}.
          </p>
          <ul className="binder-editor-volumes-list">
            {overCapacityVolumes.map((v) => (
              <li key={v.index}>
                <span className="binder-editor-volumes-index">Vol {v.index}</span>
                <span>{volumePageRange(v)}</span>
                <span className="binder-editor-volumes-spine">{volumeSpine(v)}</span>
              </li>
            ))}
          </ul>
          {fitCapacity ? (
            <Button onClick={() => applyFit(fitCapacity)}>{fitButtonLabel(fitCapacity)}</Button>
          ) : (
            <p className="form-field-hint">{noFitMessage(overCapacityVolumes.length)}</p>
          )}
        </div>
      )}
    </>
  );

  // Page filling, room and page breaks: the rules step only (an import makes
  // manual binders, which have no sections to end).
  const sharing = packSections !== false;
  const sectionEndSettings = (
    <>
      <Field label="When a section ends">
        <ChoiceList
          ariaLabel="When a section ends"
          value={packSections}
          options={[
            {
              value: false,
              label: (
                <>
                  <FillPictogram mode="false" />
                  {PACK_LABEL.false}
                </>
              ),
              hint: 'Leaves room after each section for new cards.',
            },
            {
              value: true,
              label: (
                <>
                  <FillPictogram mode="true" />
                  {PACK_LABEL.true}
                </>
              ),
              hint: "Sections share pages, but one that won't fit starts a new page.",
            },
            {
              value: 'continuous',
              label: (
                <>
                  <FillPictogram mode="continuous" />
                  {PACK_LABEL.continuous}
                </>
              ),
              hint: "A new card shifts everything after it, so it suits sets that won't grow.",
            },
          ]}
          onChange={setPackSections}
        />
      </Field>
      <Field
        label="Leave room after each section"
        hint={
          sharing
            ? 'Sections share pages here, so there is no page end to leave room at. Pick New page per section to use it.'
            : 'Empty pockets for cards you add later, so nothing after them moves.'
        }
      >
        <SegmentedControl
          ariaLabel="Leave room after each section"
          value={sharing ? 'none' : leaveRoom}
          options={LEAVE_ROOM_OPTIONS.map((o) => ({
            ...o,
            disabled: sharing && o.value !== 'none',
          }))}
          onChange={setLeaveRoom}
        />
      </Field>
      {sorts.length > 1 && (
        <Field
          label="Page breaks"
          hint={
            rulesSections
              ? 'Sections come from your rules here, so pages break only between rules.'
              : sharing
                ? 'Sections share pages here. Pick New page per section to break deeper.'
                : undefined
          }
        >
          <SelectMenu
            ariaLabel="Page breaks"
            value={breakDepth}
            onChange={(v) => setPageBreakDepth(v as number)}
            disabled={rulesSections || sharing}
            options={Array.from({ length: sorts.length }, (_, i) => ({
              value: i + 1,
              label:
                i === 0
                  ? 'Section headers only'
                  : `Each ${sortFieldLabel(sorts[i]?.field).toLowerCase()} too`,
            }))}
          />
        </Field>
      )}
    </>
  );

  // "Section headers come from": the first sort field by name, or the rules
  // by name. The rule names are the headers the binder will print: a rule's
  // name, else "Rule N" (`buildGroupSections`).
  const firstField = sorts[0]?.field && sorts[0].field !== 'none' ? sorts[0].field : null;
  const ruleHeader = (i: number) => groups[i]?.name?.trim() || `Rule ${i + 1}`;
  const ruleHeadersHint =
    groups.length >= 2
      ? `“${ruleHeader(0)}”, then “${ruleHeader(1)}”${
          groups.length > 2 ? ` and ${groups.length - 2} more` : ''
        }.`
      : `“${ruleHeader(0)}”, then your next rule. Needs two or more rules.`;

  return (
    <>
      {/* The shared Modal: focus trap and restore, exit animation, hardware
          back, the overlay-layer Escape stack. `modal-backdrop--sheet` makes
          it a bottom sheet on a phone. `dismissable={!saving}` stops a stray
          backdrop tap from tearing the editor down mid-import. */}
      <Modal
        onClose={close}
        className={`modal binder-editor${step === 'rules' ? ' binder-editor--wide' : ''}`}
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
                <IconButton
                  variant="quiet"
                  className="binder-editor-back"
                  onClick={() => setStep('start')}
                  disabled={saving}
                  label="Back to ways to start"
                  icon={<ChevronLeft width={18} height={18} strokeWidth={2} />}
                />
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
          <IconButton
            variant="quiet"
            onClick={close}
            label="Close"
            icon={<X width={20} height={20} strokeWidth={1.8} />}
          />
        </div>

        <div className="modal-body binder-editor-body">
          {step === 'start' && (
            <BinderStartChooser
              cards={cards}
              binders={binders}
              layout={layout}
              onPick={pickStart}
            />
          )}

          {step === 'rules' && (
            <>
              {phone && (
                <BinderEditorPreviewStrip
                  binder={draftPreview}
                  loading={hydrating}
                  binderName={name.trim() || 'This binder'}
                />
              )}
              <div className="binder-editor-columns">
                <div className="binder-editor-main">
                  <section className="binder-editor-cards">
                    <h3 className="form-section-heading">
                      Cards <InfoTip label="how a card lands here" text={CARDS_TIP} wide />
                    </h3>

                    {routingMode === 'manual' && existing && (
                      <div className="manual-mode-banner">
                        <p>
                          This binder uses manual mode. Only pinned cards appear; its rules are
                          paused.
                        </p>
                        <Button onClick={() => setRoutingMode('rules')}>Switch to rules</Button>
                      </div>
                    )}

                    {isNew &&
                      editingBinderSeed?.flagged &&
                      editingBinderSeed.flagged.length > 0 && (
                        <p className="binder-seed-note">
                          Some filters weren&apos;t carried over or match differently in a binder:{' '}
                          {editingBinderSeed.flagged
                            .map((key) => {
                              if (key === 'condition') return 'condition';
                              if (key === 'binder') return 'binder membership';
                              if (key === 'surplus') return 'tradeable surplus';
                              return key;
                            })
                            .join(', ')}
                          .
                        </p>
                      )}

                    <div className={routingMode === 'manual' ? 'binder-editor-paused' : undefined}>
                      <FilterGroupList
                        groups={groups}
                        cards={draftCards}
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

                    {routingMode === 'rules' && effectiveLanding && (
                      <BinderLadder
                        ladder={effectiveLanding.ladder}
                        draftId={effectiveLanding.draftId}
                        caughtAbove={effectiveLanding.caughtAbove}
                        caughtByLabel={formatCaughtBy(
                          effectiveLanding.caughtBy,
                          'a binder above this one'
                        )}
                        onMoveAbove={firstCatcher ? () => setPlaceAboveId(firstCatcher.id) : null}
                        moveAboveLabel={firstCatcher ? `Move above ${firstCatcher.name}` : ''}
                        isEmpty={
                          effectiveLanding.matches > 0 &&
                          effectiveLanding.lands === 0 &&
                          !placeAbove
                        }
                      />
                    )}

                    {routingMode === 'rules' && (
                      <div className="binder-editor-switches">
                        <SwitchRow
                          label="Include cards in decks and cubes"
                          hint="Off: a card in a deck or cube stays hidden here, even one added by hand, until you take it out."
                          checked={showDeckAllocated}
                          onChange={setShowDeckAllocated}
                        />
                        <SwitchRow
                          label="Keep printings together"
                          hint="When one copy matches here, its other printings come too, unless a binder above already took them."
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

                    {showEmptyWarning &&
                      (sitsLast ? (
                        <p className="binder-editor-note">
                          This binder has no conditions, so it takes every card the binders above
                          pass on.
                        </p>
                      ) : (
                        <div className="warn-banner binder-editor-warn">
                          This binder has no conditions, so it takes every card the binders below it
                          were meant to get. Add a condition, or move it to the bottom of your
                          binder list.
                        </div>
                      ))}

                    <div className="sr-only" role="status" aria-live="polite">
                      {liveMsg}
                    </div>
                  </section>

                  <div className="binder-editor-settings">
                    <Disclosure title="Order" summary={orderSummary}>
                      <div ref={orderRef} className="binder-editor-order">
                        <SortPresetChips
                          sorts={sorts}
                          onPick={(preset) => setSorts(preset.sorts)}
                          // The chain sits right below: move to its first
                          // field picker (E506; it was a dead chip).
                          onChooseFields={() => focusFirstSortField(orderRef.current)}
                        />
                        <SortEditor
                          sorts={sorts}
                          valueOrders={sortValueOrders}
                          onSortsChange={setSorts}
                          onValueOrdersChange={setSortValueOrders}
                        />
                      </div>
                      <Field label="Section headers come from">
                        <ChoiceList
                          ariaLabel="Section headers come from"
                          value={rulesSections ? 'group' : 'sort'}
                          options={[
                            {
                              value: 'sort',
                              label: firstField
                                ? `The first field above (${sortFieldLabel(firstField)})`
                                : 'The first field above',
                              hint: firstField
                                ? undefined
                                : 'No field is set yet, so every card sits in one section.',
                            },
                            {
                              value: 'group',
                              label: 'Each rule',
                              hint: ruleHeadersHint,
                              disabled: groups.length < 2,
                            },
                          ]}
                          onChange={setSectionMode}
                        />
                      </Field>
                    </Disclosure>
                    <Disclosure title="Pages" summary={pagesSummary}>
                      {pagesSettings}
                      {sectionEndSettings}
                    </Disclosure>
                  </div>

                  <SwitchRow
                    label="Offer for trade"
                    hint="Cards here can appear on a game night's trade board when you opt in."
                    checked={tradeable}
                    onChange={setTradeable}
                  />
                </div>
                {!phone && <BinderEditorPreview binder={draftPreview} loading={hydrating} />}
              </div>
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
                          <IconButton
                            className="staged-files-remove"
                            onClick={() =>
                              applyStagedFiles(
                                importFiles_.filter((_, idx) => idx !== i),
                                importFiles_
                              )
                            }
                            disabled={saving}
                            label={`Remove ${f.name}`}
                            title="Remove"
                            icon={<X width={14} height={14} strokeWidth={1.8} />}
                          />
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

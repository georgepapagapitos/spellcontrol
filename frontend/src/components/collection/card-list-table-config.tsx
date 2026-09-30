import { AlignJustify, LayoutGrid, List as ListIconLucide } from 'lucide-react';
import type { SortField, EnrichedCard } from '@/types/index';
import type { BinderInfo } from '@/components/BinderBadge';
import type { CardTableCol } from '@/components/shared/CardTable';
import type { SortMenuOption } from '@/components/search/SortMenu';
import { sortDirectionLabel } from '@/lib/search/sorting';
import { readLocalStorage } from '@/lib/util/local-storage';

// Row model, view/sort/group vocabularies and their persisted-state helpers
// for CardListTable, split out of it (T176). Pure declarations: no hooks.

export interface Row {
  key: string;
  card: EnrichedCard;
  qty: number;
  // Primary binder for this row — first copy seen. Drives section grouping
  // and the move-to-binder menu's "currently in" anchor.
  binderId: string | null;
  binderName: string | null;
  binderColor: string | null;
  // All binders covering any of this row's copies, deduped by id. When
  // grouping is off this is at most one entry; when grouping is on the
  // badge surfaces every binder the stacked copies are in.
  binders: BinderInfo[];
}

export type ViewMode = 'grid' | 'list' | 'compact';

export const COLLECTION_VIEW_KEY = 'mtg-collection-view-mode';
export const GRID_SIZE_KEY = 'mtg-collection-grid-size';

/** Shortcut items contributed to the registry under the "Collection" section.
 *  "Add cards" is a no-op on a scoped view (a single binder) where the caller
 *  doesn't pass `onAddCards` — same as the view toggles above it, which apply
 *  everywhere this table renders regardless of whether that's useful there. */
export const COLLECTION_SHORTCUTS = [
  { keys: ['/'], description: 'Focus search' },
  { keys: ['g'], description: 'Switch to grid view' },
  { keys: ['l'], description: 'Switch to list view' },
  { keys: ['c'], description: 'Switch to compact list' },
  { keys: ['a'], description: 'Add cards' },
];

export function readStoredCollectionView(): ViewMode {
  try {
    const v = localStorage.getItem(COLLECTION_VIEW_KEY);
    if (v === 'grid' || v === 'list' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  // No explicit choice on record (E127) — default posture is card-forward
  // grid. Only fires when nothing was ever persisted; an explicit list/
  // compact choice above always wins.
  return 'grid';
}

export const VIEW_MODE_OPTIONS = [
  {
    value: 'grid' as const,
    label: 'Grid view',
    icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
  },
  {
    value: 'list' as const,
    label: 'List view (with thumbnails)',
    icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
  },
  {
    value: 'compact' as const,
    label: 'Compact list (text only)',
    icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
  },
];

export type SortKey =
  'name' | 'set' | 'rarity' | 'price' | 'edhrec' | 'qty' | 'cmc' | 'release' | 'added' | 'edited';

export const ROW_HEIGHT_LIST = 66;
export const ROW_HEIGHT_COMPACT = 32;
// Which of the shared table's columns drive a sort here, and the sort key
// each one sets. Columns absent from this map render as labels (the SortMenu
// still covers every key, and is the phone path where the table doesn't
// exist). The column ORDER and labels live in `shared/CardTable`, with the
// matching cells — this file no longer restates them.
export const COLLECTION_TABLE_SORTS: Partial<Record<CardTableCol, SortKey>> = {
  qty: 'qty',
  name: 'name',
  set: 'set',
  mana: 'cmc',
  price: 'price',
};
// Fixed height of a full-width "Group by" section header row in grid view.
// Keep in sync with .collection-grid-section-header in styles/collection.css.
export const GRID_SECTION_HEADER_H = 40;

export const COLOR_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

export const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

export const SORT_FIELDS: Array<{ key: SortKey; label: string; defaultDir: 'asc' | 'desc' }> = [
  { key: 'name', label: 'Name', defaultDir: 'asc' },
  { key: 'cmc', label: 'Mana value', defaultDir: 'asc' },
  { key: 'price', label: 'Price', defaultDir: 'desc' },
  { key: 'edhrec', label: 'EDHREC rank', defaultDir: 'asc' },
  { key: 'qty', label: 'Quantity', defaultDir: 'desc' },
  { key: 'rarity', label: 'Rarity', defaultDir: 'asc' },
  { key: 'set', label: 'Set', defaultDir: 'asc' },
  { key: 'release', label: 'Release date', defaultDir: 'desc' },
  { key: 'added', label: 'Date added', defaultDir: 'desc' },
  { key: 'edited', label: 'Last edited', defaultDir: 'desc' },
];

export const SORT_KEY_TO_FIELD: Record<SortKey, SortField> = {
  name: 'name',
  set: 'setName',
  rarity: 'rarity',
  price: 'price',
  edhrec: 'edhrec',
  qty: 'quantity',
  cmc: 'cmc',
  release: 'setReleaseDate',
  added: 'dateAdded',
  edited: 'dateEdited',
};

export const SORT_FIELD_BY_KEY: Record<SortKey, (typeof SORT_FIELDS)[number]> = SORT_FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<SortKey, (typeof SORT_FIELDS)[number]>
);

// Direction wording comes from the shared per-field vocabulary rather than
// being restated here — these keys already map onto the SortField union that
// owns it, so "Newest first" / "Most played" stay one string app-wide.
export const SORT_MENU_OPTIONS: SortMenuOption<SortKey>[] = SORT_FIELDS.map((f) => ({
  value: f.key,
  label: f.label,
  dirLabels: [
    sortDirectionLabel(SORT_KEY_TO_FIELD[f.key], 'asc'),
    sortDirectionLabel(SORT_KEY_TO_FIELD[f.key], 'desc'),
  ],
}));

// "Group by" sections the visible rows under per-attribute headers, reusing the
// binder-routing sectioning engine (getSectionMeta) so the buckets/labels/order
// match how binders already section the same cards. Applies to all three views
// (list/compact inline headers; grid full-width header rows via buildGridLayout).
export type GroupKey = 'none' | 'color' | 'type' | 'cmc' | 'rarity' | 'set';

export const GROUP_FIELDS: Array<{ key: GroupKey; label: string }> = [
  { key: 'none', label: 'No grouping' },
  { key: 'color', label: 'Color' },
  { key: 'type', label: 'Type' },
  { key: 'cmc', label: 'Mana value' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'set', label: 'Set' },
];

// Map each group choice to the binder-routing SortField getSectionMeta keys off.
// "set" uses setReleaseDate (not setName) so sections order chronologically;
// setName returns order:0 for every set, leaving the order to alphabetical-by-key.
export const GROUP_KEY_TO_FIELD: Record<Exclude<GroupKey, 'none'>, SortField> = {
  color: 'color',
  type: 'type',
  cmc: 'cmc',
  rarity: 'rarity',
  set: 'setReleaseDate',
};

// Per-group-field localStorage key for the set of collapsed section keys, so a
// "Red" fold under Color grouping is remembered independently of a "Lands" fold
// under Type grouping.
const COLLAPSED_KEY_PREFIX = 'spellcontrol:collection:collapsed:';
export const loadCollapsedKeys = (g: GroupKey): Set<string> =>
  g === 'none'
    ? new Set()
    : new Set(readLocalStorage<string[]>(COLLAPSED_KEY_PREFIX + g, JSON.parse, []));
export const persistCollapsedKeys = (g: GroupKey, keys: Set<string>) => {
  if (g === 'none') return;
  try {
    localStorage.setItem(COLLAPSED_KEY_PREFIX + g, JSON.stringify([...keys]));
  } catch {
    /* ignore – SSR / private-browsing / quota errors */
  }
};

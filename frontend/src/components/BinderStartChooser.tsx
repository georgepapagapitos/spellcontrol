import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CHOOSER_COLOR_KEYS,
  STARTER_TEMPLATES,
  colorPickFilter,
  type ChooserColorKey,
  type StarterTemplate,
  type TemplateGroup,
} from '../lib/binder-templates';
import { useCardTagsError, useCardTagsReady, useCardsWithTags } from '../lib/card-tags';
import { useCardsWithSpareCopies } from '../lib/spare-copies';
import {
  useChooserPreviews,
  type PreviewRequest,
  type TilePreview,
} from '../lib/binder-chooser-preview';
import { SORT_PRESETS } from '../lib/sorting';
import { formatCaughtBy } from '../lib/binder-counts';
import { ColorPip } from './shared/ManaSymbol';
import { SectionHeader } from './shared/SectionHeader';
import type { BinderDef, BinderFilter, EnrichedCard } from '../types';
import type { BinderLayoutInputs } from '../lib/use-binder-layout-inputs';
import { useCollectionStore } from '../store/collection';
import { COLOR_INFO } from '../lib/colors';

/** The lead tile's little shelf: a row of binder spines in the color-group
 *  swatches the planner itself uses, decorative only. Heights vary so it reads
 *  as books, not a bar chart. */
const SHELF_SPINES = (['W', 'U', 'B', 'R', 'G', 'M'] as const).map((k, i) => ({
  color: COLOR_INFO[k].pip,
  h: [88, 80, 94, 76, 90, 72][i],
}));

export type BinderStart =
  | { kind: 'template'; template: StarterTemplate; color?: ChooserColorKey }
  | { kind: 'blank' }
  /** "Everything else": a real binder, empty filter, named on creation — a
   *  new binder always appends LAST, so first-match-wins alone is what makes
   *  it a catch-all. Not a StarterTemplate: an empty filter is exactly what
   *  `binder-templates.test.ts` guards every OTHER template against. */
  | { kind: 'catch-all' }
  | { kind: 'import' };

const GROUP_ORDER: TemplateGroup[] = ['pull', 'slice', 'pool'];
const GROUP_LABEL: Record<TemplateGroup, string> = {
  pull: 'Pull out a pile',
  slice: 'One slice',
  pool: 'Deck-building pools',
};

const COLOR_WORD: Record<ChooserColorKey, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  M: 'multicolor',
  C: 'colorless',
};
const COLOR_BINDER_NAME: Record<ChooserColorKey, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  M: 'Multicolor',
  C: 'Colorless',
};

const usesTags = (f: Partial<BinderFilter> | undefined) => !!f?.oracleTagChips?.chips.length;

const presetName = (id: string): string | null =>
  SORT_PRESETS.find((p) => p.id === id)?.name ?? null;

interface TileLines {
  /** The would-land answer with its page count ("55 cards · 7 pages"), "No
   *  cards match", or the fully-taken sentence when nothing would land. */
  primary: string;
  /** Only when the would-land count differs from the raw match: how many
   *  matched, and which binder already holds the rest. */
  secondary?: string;
}

const pagesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'page' : 'pages'}`;

/**
 * A tile always states pages on its primary line, and that line is what would
 * actually land in the new binder, not the raw match. When those differ, a
 * second, quieter line says how many matched and names the binder holding the
 * rest; when nothing would land, one sentence says so (there are no pages).
 */
function tileLines(
  preview: TilePreview | 'loading' | undefined,
  noun: { one: string; many: string } = { one: 'card', many: 'cards' }
): TileLines {
  if (!preview || preview === 'loading') return { primary: 'Counting…' };
  const { matches, lands, pages, caughtBy } = preview;
  if (matches === 0) return { primary: `No ${noun.many} match` };
  const holder = formatCaughtBy(caughtBy, 'another binder');
  if (lands === 0) {
    return {
      primary:
        matches === 1
          ? `The only match is in ${holder} now`
          : `All ${matches.toLocaleString()} are in ${holder} now`,
    };
  }
  const primary = `${lands.toLocaleString()} ${lands === 1 ? noun.one : noun.many} · ${pagesWord(pages)}`;
  if (lands === matches) return { primary };
  const held = matches - lands;
  return {
    primary,
    secondary: `of ${matches.toLocaleString()} that match; ${held.toLocaleString()} ${held === 1 ? 'is' : 'are'} in ${holder}`,
  };
}

/** "Everything else" only ever shows what would actually land there — an
 *  empty filter's raw match count is the whole collection, which isn't news. */
function catchAllLines(preview: TilePreview | 'loading' | undefined): TileLines {
  if (!preview || preview === 'loading') return { primary: 'Counting…' };
  const { lands, pages } = preview;
  if (lands === 0) return { primary: 'Nothing left over now' };
  return {
    primary: `${lands.toLocaleString()} ${lands === 1 ? 'card' : 'cards'} now · ${pagesWord(pages)}`,
  };
}

/**
 * A new binder's first step: what goes in it, grouped by job (E495) so tiles
 * doing the same kind of work sit together instead of a flat grid that mixes
 * "keep this safe" with "feed a deck". Every tile that means something today
 * states the order it will use and the page count it lands on, from a real
 * materialize against the user's OWN binders — "would land here", not just
 * "matches", so an overlapping tile (Mana rocks inside Ramp) says so before
 * you commit. "From a list" is a start of its own rather than a mode toggle,
 * because an imported binder shares almost nothing with a rules binder.
 */
export function BinderStartChooser({
  cards,
  binders,
  layout,
  onPick,
}: {
  cards: EnrichedCard[];
  binders: BinderDef[];
  layout: Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'>;
  onPick: (start: BinderStart) => void;
}) {
  const tagged = useCardsWithTags(cards, true);
  // Trade binder's filter needs `spareCopy` decorated too — always on, same
  // as tags above (several tiles use one or the other unconditionally).
  const decorated = useCardsWithSpareCopies(tagged, layout.allocatedCopyIds, true);
  const tagsReady = useCardTagsReady(true);
  // A failed tag load leaves those tiles without a count rather than on a
  // "Counting…" that never resolves; the template itself still works.
  const tagsFailed = useCardTagsError();
  const navigate = useNavigate();
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);

  // "Plan a shelf" (E496) opens a sheet of its own, not another editor step —
  // close this one (setEditingBinder(null), the same action the editor's own
  // Cancel uses) and hand off to the binders index via a query param, since
  // the planner is owned by BindersIndexPage, one layer up from the editor
  // modal this chooser lives inside.
  const planAShelf = () => {
    setEditingBinder(null);
    navigate('/collection/binders?planShelf=1');
  };
  const colorGroupName = useId();

  // No more silent white (E473): the pick starts on White but is a real,
  // visible, changeable choice — every render shows which pip is selected.
  const [oneColor, setOneColor] = useState<ChooserColorKey>('W');

  const requests = useMemo<PreviewRequest[]>(() => {
    const out: PreviewRequest[] = [];
    for (const t of STARTER_TEMPLATES) {
      if (t.revealSets) continue; // "Pick the set next" — nothing to preview yet
      if (usesTags(t.filter) && !tagsReady) continue; // don't preview off untagged cards
      const filter = t.colorPick ? colorPickFilter(oneColor) : (t.filter ?? {});
      const preset = SORT_PRESETS.find((p) => p.id === t.sortPreset);
      out.push({ key: t.id, filter, sorts: preset?.sorts ?? [] });
    }
    // "Everything else": an empty filter appended last lands exactly the
    // current uncategorized pile — first-match-wins does the rest.
    out.push({ key: '__catch-all__', filter: {}, sorts: [] });
    return out;
  }, [oneColor, tagsReady]);

  const previews = useChooserPreviews(requests, decorated, binders, layout);

  const renderTile = (t: StarterTemplate, autoFocus: boolean) => {
    const preview = previews.get(t.id);
    const order = presetName(t.sortPreset);
    const lines: TileLines | null = t.revealSets
      ? { primary: 'Pick the set next' }
      : usesTags(t.filter) && !tagsReady
        ? tagsFailed
          ? null
          : { primary: 'Counting…' }
        : t.colorPick
          ? tileLines(preview, {
              one: `${COLOR_WORD[oneColor]} card`,
              many: `${COLOR_WORD[oneColor]} cards`,
            })
          : tileLines(preview);

    if (t.colorPick) {
      // Title, then the pips, then order and count, as on every other tile.
      // The radios can't sit inside the tile's <button>, so the button holds
      // order and count and stretches over the whole tile (::after); the pips
      // sit above that layer. One tab stop to create, one radiogroup to pick,
      // and a click anywhere else on the tile creates, like any other tile.
      const titleId = `${colorGroupName}-title`;
      const bodyId = `${colorGroupName}-body`;
      return (
        <div key={t.id} className="binder-start-tile binder-start-tile--color">
          <span id={titleId} className="binder-start-tile-label">
            {t.label}
          </span>
          <fieldset className="binder-start-color-pips">
            <legend className="sr-only">Which color</legend>
            {CHOOSER_COLOR_KEYS.map((key) => (
              <label
                key={key}
                className={`binder-start-color-pip${key === oneColor ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name={colorGroupName}
                  checked={key === oneColor}
                  onChange={() => setOneColor(key)}
                  aria-label={COLOR_BINDER_NAME[key]}
                />
                <ColorPip color={key} />
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            id={bodyId}
            aria-labelledby={`${titleId} ${bodyId}`}
            className="binder-start-tile-body"
            autoFocus={autoFocus}
            onClick={() => onPick({ kind: 'template', template: t, color: oneColor })}
          >
            {order && <span className="binder-start-tile-order">{order}</span>}
            {lines && <span className="binder-start-tile-count">{lines.primary}</span>}
            {lines?.secondary && (
              <span className="binder-start-tile-count-secondary">{lines.secondary}</span>
            )}
          </button>
        </div>
      );
    }

    return (
      <button
        key={t.id}
        type="button"
        autoFocus={autoFocus}
        className="binder-start-tile"
        onClick={() => onPick({ kind: 'template', template: t })}
      >
        <span className="binder-start-tile-label">{t.label}</span>
        <span className="binder-start-tile-desc">{t.description}</span>
        {t.overlapNote && <span className="binder-start-tile-overlap">{t.overlapNote}</span>}
        {order && <span className="binder-start-tile-order">{order}</span>}
        {lines && <span className="binder-start-tile-count">{lines.primary}</span>}
        {lines?.secondary && (
          <span className="binder-start-tile-count-secondary">{lines.secondary}</span>
        )}
      </button>
    );
  };

  // Start on the first choice, not on the dialog's close button — computed
  // once, rather than a mutable counter threaded through the render below
  // (React Compiler flags reassigning a render-scoped variable as unsafe).
  const firstTileId = STARTER_TEMPLATES.find((t) => t.group)?.id;

  return (
    <div className="binder-start">
      {cards.length > 0 && (
        // The lead tile (E496): most people don't want one binder, they want
        // their whole collection on a shelf. It leads, a full row above the
        // groups, and opens the planner rather than a single-binder draft.
        <button
          type="button"
          className="binder-start-tile binder-start-tile--shelf"
          onClick={planAShelf}
        >
          <span className="binder-start-shelf" aria-hidden="true">
            {SHELF_SPINES.map((s, i) => (
              <i key={i} style={{ height: `${s.h}%`, background: s.color }} />
            ))}
          </span>
          <span className="binder-start-shelf-text">
            <span className="binder-start-tile-label">Organize my whole collection</span>
            <span className="binder-start-tile-desc">
              A set of binders that covers everything, by color, by set or by value. You pick which
              to keep.
            </span>
          </span>
          <span className="binder-start-shelf-cta">Plan a shelf</span>
        </button>
      )}
      <div className="binder-start-head">
        <h3 className="binder-start-title">What goes in it?</h3>
        <p className="binder-start-sub">You can change everything after.</p>
      </div>

      {GROUP_ORDER.map((group) => {
        const tiles = STARTER_TEMPLATES.filter((t) => t.group === group);
        return (
          <div className="binder-start-group" key={group}>
            <SectionHeader
              title={GROUP_LABEL[group]}
              variant="overline"
              level={3}
              titleClassName="binder-start-group-title"
            />
            {/* One row, no orphan: a 4-tile group gets 4 columns at desktop
                (E495 coordinator review), not the 3-column default that would
                wrap its 4th tile alone. The narrow-dialog breakpoints below
                override this back down regardless of count. */}
            <div className="binder-start-tiles" data-count={tiles.length}>
              {tiles.map((t) => renderTile(t, t.id === firstTileId))}
            </div>
          </div>
        );
      })}

      <div className="binder-start-group binder-start-group--dash">
        <div className="binder-start-tiles">
          <button
            type="button"
            className="binder-start-tile binder-start-tile--alt"
            onClick={() => onPick({ kind: 'blank' })}
          >
            <span className="binder-start-tile-label">Blank</span>
            <span className="binder-start-tile-desc">Write your own rules</span>
          </button>
          <button
            type="button"
            className="binder-start-tile binder-start-tile--alt"
            onClick={() => onPick({ kind: 'catch-all' })}
          >
            <span className="binder-start-tile-label">Everything else</span>
            <span className="binder-start-tile-desc">Catches whatever no other binder takes</span>
            <span className="binder-start-tile-count">
              {catchAllLines(previews.get('__catch-all__')).primary}
            </span>
          </button>
          <button
            type="button"
            className="binder-start-tile binder-start-tile--alt binder-start-tile--wide"
            onClick={() => onPick({ kind: 'import' })}
          >
            <span className="binder-start-tile-label">From a list</span>
            <span className="binder-start-tile-desc">
              Paste a list or upload CSV files. Cards are added and kept in your order.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Binder name a picked start seeds — a color pick names itself ("Blue"),
 *  everything else keeps its template label. Exported so `BinderEditor`
 *  doesn't re-derive the color-name map. */
export function startBinderName(start: BinderStart): string | null {
  if (start.kind === 'template') {
    if (start.template.colorPick && start.color) return COLOR_BINDER_NAME[start.color];
    return start.template.label;
  }
  if (start.kind === 'catch-all') return 'Everything else';
  return null;
}

/** Every name a picked start can seed, so `BinderEditor` can tell "the user
 *  kept a previous tile's name" apart from "the user typed their own" when
 *  switching starts without ever leaving the `start` step. */
export const CHOOSER_START_LABELS: string[] = [
  ...STARTER_TEMPLATES.map((t) => t.label),
  ...Object.values(COLOR_BINDER_NAME),
  'Everything else',
];

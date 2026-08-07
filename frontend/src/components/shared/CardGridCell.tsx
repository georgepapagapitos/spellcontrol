import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { EnrichedCard } from '../../types';
import { classifyFoil } from '../../lib/foil-style';
import { useCardThumb } from '../../lib/card-thumbs';
import { ProxyBadge } from './ProxyBadge';
import { PriceOverrideBadge } from './PriceOverrideBadge';
import { RarityBadge } from './RarityBadge';
import { SetSymbol } from './SetSymbol';

/**
 * Grid captions — the detail lines under a grid tile, per-line toggleable from
 * the "Details" toolbar popover (mirroring the decks "Show" prefs): persisted
 * per device, default on, and SHARED across every grid surface (one key, one
 * set of toggles — flipping them in the collection flips them on a list too).
 * `sortValue` echoes the active sort key's value (dates for the date sorts,
 * EDHREC rank for that sort, otherwise the card's price); `set` is the
 * collector-app set line — rarity-tinted keyrune symbol + set code · collector
 * number.
 */
export interface GridCaptionPrefs {
  sortValue: boolean;
  set: boolean;
}

const GRID_CAPTION_PREFS_KEY = 'mtg-collection-grid-caption-prefs';
// Pre-details boolean key (PR #1203) — read once for migration, then unused.
const GRID_CAPTION_LEGACY_KEY = 'mtg-collection-grid-caption';
const DEFAULT_GRID_CAPTION_PREFS: GridCaptionPrefs = { sortValue: true, set: true };
const GRID_CAPTION_LABEL: Record<keyof GridCaptionPrefs, string> = {
  sortValue: 'Price / sort value',
  set: 'Set & rarity',
};

/**
 * Rendered height (px) of ONE caption line, and the extra height the caption
 * footer plate adds below the last line — keep both in sync with
 * .collection-grid-captions / .collection-grid-caption in styles/collection.css.
 * Folded into the collection grid virtualizer's row-height estimate, which is
 * measureElement-free, so an estimate/CSS mismatch shows up as scroll drift.
 */
export const GRID_CAPTION_H = 20;
export const GRID_CAPTION_PLATE_PAD = 4;

function readStoredGridCaptionPrefs(): GridCaptionPrefs {
  try {
    const raw = localStorage.getItem(GRID_CAPTION_PREFS_KEY);
    if (raw) {
      return { ...DEFAULT_GRID_CAPTION_PREFS, ...(JSON.parse(raw) as Partial<GridCaptionPrefs>) };
    }
    // Migrate the legacy all-or-nothing toggle: an explicit "off" carries over
    // as everything off; "on"/absent falls through to the defaults.
    if (localStorage.getItem(GRID_CAPTION_LEGACY_KEY) === '0') {
      return { sortValue: false, set: false };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_GRID_CAPTION_PREFS;
}

/** Caption prefs state + write-through persistence, for any grid surface. */
export function useGridCaptionPrefs(): [GridCaptionPrefs, (next: GridCaptionPrefs) => void] {
  const [prefs, setPrefs] = useState<GridCaptionPrefs>(readStoredGridCaptionPrefs);
  const update = (next: GridCaptionPrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(GRID_CAPTION_PREFS_KEY, JSON.stringify(next));
      localStorage.removeItem(GRID_CAPTION_LEGACY_KEY);
    } catch {
      /* ignore */
    }
  };
  return [prefs, update];
}

/** Checkbox list for the caption prefs — the body of a "Details" popover. */
export function GridCaptionList({
  prefs,
  onChange,
}: {
  prefs: GridCaptionPrefs;
  onChange: (next: GridCaptionPrefs) => void;
}) {
  return (
    <ul className="toolbar-popover-list" role="menu" aria-label="Card details">
      {(Object.keys(GRID_CAPTION_LABEL) as (keyof GridCaptionPrefs)[]).map((k) => (
        <li key={k}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs[k]}
            className={`toolbar-popover-item${prefs[k] ? ' active' : ''}`}
            onClick={() => onChange({ ...prefs, [k]: !prefs[k] })}
          >
            <span className="toolbar-popover-check" aria-hidden>
              {prefs[k] ? '✓' : ''}
            </span>
            {GRID_CAPTION_LABEL[k]}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The set caption's label — "SET · 123" — or null when the line is off. */
export function gridSetLabel(card: EnrichedCard, prefs: GridCaptionPrefs): string | null {
  if (!prefs.set) return null;
  return `${card.setCode.toUpperCase()}${card.collectorNumber ? ` · ${card.collectorNumber}` : ''}`;
}

interface CardGridCellProps {
  card: EnrichedCard;
  /** Copies this tile stands for; the ×qty chip shows only when >1. */
  qty: number;
  /** Zoom bucket from lib/grid-zoom's `zoomBucket` → the `grid-<size>` class. */
  size: '1x' | '2x' | '3x';
  /** Click / Enter / Space on the tile (preview, or toggle in select mode). */
  onActivate: () => void;
  /** Caption line 1 — the active sort key's value. null hides the line. */
  caption?: string | null;
  /** Caption line 2 — set symbol + `gridSetLabel`. null hides the line. */
  setLabel?: string | null;
  /** Collection bulk-select affordances. */
  selectMode?: boolean;
  selected?: boolean;
  /** Chips rendered beside the ×qty badge in the bottom-left corner. */
  cornerExtras?: ReactNode;
  /** Bottom-right badge cluster (deck/binder) — collection only. */
  badges?: ReactNode;
  /** Appended to the tile's aria-label (e.g. surplus copies). */
  ariaExtra?: string;
}

/**
 * The single card tile used by every grid surface (collection, lists) — the
 * grid twin of `CardRow`. Owns the `.collection-grid-*` visual contract: art
 * with foil treatment, the rarity badge / corner chips / badge cluster
 * overlays, and the "Details" caption plate below the card. Interaction,
 * virtualization and per-surface chips stay with the caller; this is purely
 * presentational. See STYLE_GUIDE "Card row information hierarchy".
 */
export function CardGridCell({
  card,
  qty,
  size,
  onActivate,
  caption = null,
  setLabel = null,
  selectMode = false,
  selected = false,
  cornerExtras,
  badges,
  ariaExtra,
}: CardGridCellProps) {
  const foilStyle = classifyFoil(card);
  const foilClass = foilStyle !== 'none' ? ` is-foil foil-${foilStyle}` : '';
  // Name-keyed CDN thumb is only a fallback — it resolves to Scryfall's
  // default printing, so the row card's own art always wins.
  const thumb = useCardThumb(card.imageNormal ? undefined : card.name, 'normal');
  const art = card.imageNormal ?? thumb;

  return (
    <div className="collection-grid-cell">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectMode ? selected : undefined}
        className={`collection-grid-item grid-${size}${foilClass}${
          selectMode ? ' is-selectable' : ''
        }${selected ? ' is-selected' : ''}`}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
        aria-label={`${card.name}, quantity ${qty}${card.foil ? ', foil' : ''}${
          card.proxy ? ', proxy' : ''
        }${card.priceOverride !== undefined ? ', manually priced' : ''}${
          caption && caption !== '—' ? `, ${caption}` : ''
        }${setLabel ? `, ${setLabel}` : ''}${ariaExtra ?? ''}${
          selectMode ? (selected ? ', selected' : ', not selected') : ''
        }`}
      >
        {selectMode && (
          <span className="collection-grid-check" data-checked={selected} aria-hidden>
            {selected && <Check width={14} height={14} strokeWidth={3} />}
          </span>
        )}
        {art ? (
          <img src={art} alt={card.name} loading="lazy" className="collection-grid-img" />
        ) : (
          <div className="collection-grid-placeholder">{card.name}</div>
        )}
        {card.foil && (
          <>
            <div className="card-preview-foil-shine" aria-hidden="true" />
            <div className="card-preview-foil-glare" aria-hidden="true" />
          </>
        )}
        {/* The Set & rarity caption line carries rarity (glyph tint) and set
            code, so the on-card overlays that duplicate them are suppressed
            while it's shown. The proxy chip is independent of that toggle —
            it must stay legible regardless of caption prefs or select mode,
            so it lives in its own top-right cluster alongside rarity. */}
        {(card.proxy || card.priceOverride !== undefined || setLabel === null) && (
          <div className="collection-grid-topright">
            <ProxyBadge card={card} className="collection-grid-proxy" />
            <PriceOverrideBadge card={card} className="collection-grid-price-override" />
            {setLabel === null && (
              <RarityBadge rarity={card.rarity} className="collection-grid-rarity" />
            )}
          </div>
        )}
        {(qty > 1 || cornerExtras) && (
          <div className="collection-grid-corner">
            {qty > 1 && (
              <span className="collection-grid-qty">
                <span className="collection-grid-qty-x" aria-hidden="true">
                  ×
                </span>
                {qty}
              </span>
            )}
            {cornerExtras}
          </div>
        )}
        {badges && <div className="collection-grid-badges">{badges}</div>}
      </div>
      {(caption !== null || setLabel !== null) && (
        <div className="collection-grid-captions" aria-hidden="true">
          {caption !== null && <div className="collection-grid-caption">{caption}</div>}
          {setLabel !== null && (
            <div className="collection-grid-caption collection-grid-caption--set">
              <SetSymbol setCode={card.setCode} rarity={card.rarity} />
              <span className="collection-grid-caption-set-label">{setLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

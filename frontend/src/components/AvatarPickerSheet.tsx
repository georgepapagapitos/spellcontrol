import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useCollectionStore } from '../store/collection';
import { useSearchCards } from '../lib/use-search-cards';
import { imageFromCard, loadCard, useCardThumb } from '../lib/card-thumbs';
import { SearchPill } from './SearchPill';
import type { EnrichedCard } from '../types';
import type { AvatarPatch } from '../lib/auth-api';
import './AvatarPickerSheet.css';

interface Props {
  /** The currently-saved (or previously staged) avatar, if any — governs
   *  whether "Remove avatar" renders. */
  current: AvatarPatch | null;
  /** Fires the moment a pick is confirmed (tap/Enter) or removed — no network
   *  round-trip here; the caller stages it, saved together with the rest of
   *  the profile through ProfileEditor's single Save action. */
  onPick: (avatar: AvatarPatch | null) => void;
  onClose: () => void;
}

/** Cap the unvirtualized collection-browse grid — search covers the rest. */
const BROWSE_CAP = 300;

interface AvatarOption {
  /** React key + listbox-option id suffix. */
  key: string;
  name: string;
  /** Pre-resolved (search results already carry a full ScryfallCard); absent
   *  for collection-browse options, which resolve lazily by name. */
  imageUrl?: string;
  scryfallId?: string;
}

/**
 * One tile in the avatar grid. Collection-browse options arrive name-only
 * (no `imageUrl`/`scryfallId`) and resolve their art via the same batched
 * `useCardThumb` cache every other name-only surface uses; search results
 * already carry a resolved `ScryfallCard`, so `imageUrl` is passed straight
 * through and the hook stays idle (mirrors DeckCardRow's `imageUrl ? undefined
 * : name` idiom).
 */
function AvatarOptionTile({
  option,
  id,
  active,
  onHover,
  onPick,
}: {
  option: AvatarOption;
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const resolved = useCardThumb(option.imageUrl ? undefined : option.name, 'art_crop');
  const src = option.imageUrl ?? resolved;

  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      aria-label={option.name}
      className={`avatar-picker-tile${active ? ' is-active' : ''}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // preventDefault (not onClick) so the search input never blurs before
        // the pick registers — mirrors SetFilterPicker's option-row pattern.
        e.preventDefault();
        onPick();
      }}
    >
      {src ? (
        <img src={src} alt="" className="avatar-picker-tile-img" />
      ) : (
        <span className="avatar-picker-tile-img avatar-picker-tile-img-loading" aria-hidden />
      )}
      <span className="avatar-picker-tile-name" aria-hidden="true">
        {option.name}
      </span>
    </li>
  );
}

/**
 * Card-art avatar picker, opened from ProfileEditor's "Choose avatar" trigger.
 * Reuses the `.card-picker-root`/`.card-picker-sheet` shell verbatim (auto-
 * scrim, no new scrim code) and mirrors AddCardsSheet's portal/dismiss wiring.
 * Empty query browses the collection (deduped by name, capped at 300 —
 * search covers the rest); 2+ chars switches to a live Scryfall search. Both
 * render into the SAME `role="listbox"` grid with roving `aria-activedescendant`
 * (the full combobox ARIA set per STYLE_GUIDE — see SetFilterPicker.tsx),
 * driven by the search input's own arrow-key handling exactly like
 * AddCardSearchPanel's results list.
 */
export function AvatarPickerSheet({ current, onPick, onClose }: Props) {
  const titleId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  const collection = useCollectionStore((s) => s.cards);
  const { results, loading, error } = useSearchCards(query);

  useLockBodyScroll();

  const { cards: browseCards, hasMore: browseHasMore } = useMemo(() => {
    const seen = new Map<string, EnrichedCard>();
    for (const card of collection) {
      if (!seen.has(card.name)) seen.set(card.name, card);
    }
    const sorted = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { cards: sorted.slice(0, BROWSE_CAP), hasMore: sorted.length > BROWSE_CAP };
  }, [collection]);

  const options: AvatarOption[] = useMemo(() => {
    if (searching) {
      return results.map((c) => ({
        key: c.id,
        name: c.name,
        imageUrl: imageFromCard(c, 'art_crop'),
        scryfallId: c.id,
      }));
    }
    return browseCards.map((c) => ({ key: c.name, name: c.name }));
  }, [searching, results, browseCards]);

  // Reset the highlighted option whenever the async search results change
  // (mirrors AddCardSearchPanel exactly, including the microtask defer that
  // avoids a synchronous setState inside the effect body).
  useEffect(() => {
    void Promise.resolve().then(() => setActiveIndex(0));
  }, [results]);

  // Symmetric exit so every dismiss path (backdrop, ✕, Escape, a pick) plays
  // the shell's slide-out before unmount instead of teleport-vanishing.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  // ≥1024px the shell renders as a centered panel with `animation: none`, so
  // `.is-closing` would never fire onAnimationEnd there — call onClose
  // directly rather than waiting on an exit that never plays (mirrors
  // CardPickerSheet/AddCardSheet's identical breakpoint check).
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Focus moves to the search field on open (autoFocus below); return it to
  // whatever was focused before the sheet opened (the "Choose avatar"
  // trigger) on every close path, without the caller needing to manage a ref.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (prevFocused?.isConnected) prevFocused.focus?.();
    };
  }, []);

  const resolveAvatar = async (option: AvatarOption): Promise<AvatarPatch | null> => {
    if (option.imageUrl && option.scryfallId) {
      return { cardId: option.scryfallId, cardName: option.name, imageUrl: option.imageUrl };
    }
    // Collection-browse option: the tile already resolved (and rendered) this
    // name via useCardThumb, so the module cache almost always answers this
    // instantly with no network round-trip.
    const card = await loadCard(option.name);
    if (!card) return null;
    const imageUrl = imageFromCard(card, 'art_crop');
    if (!imageUrl) return null;
    return { cardId: card.id, cardName: card.name, imageUrl };
  };

  const pick = (option: AvatarOption) => {
    // The tap is the confirm — close immediately once resolution lands
    // (near-instant; see resolveAvatar). No network round-trip yet: the
    // caller stages this and saves it together with the rest of the profile.
    void resolveAvatar(option).then((avatar) => {
      if (avatar) {
        onPick(avatar);
        dismiss();
      }
    });
  };

  const handleQueryChange = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        setActiveIndex(0);
        return;
      }
      dismiss();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (options.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (options.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (options.length === 0) return;
      e.preventDefault();
      const option = options[Math.min(activeIndex, options.length - 1)];
      if (option) pick(option);
    }
  };

  const clampedActive = Math.min(activeIndex, Math.max(options.length - 1, 0));

  return createPortal(
    <div
      className="card-picker-root avatar-picker-root"
      onClick={() => dismiss()}
      role="presentation"
    >
      <div
        className={`card-picker-sheet avatar-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="avatar-picker-head">
          <h2 id={titleId} className="avatar-picker-title">
            Choose your avatar
          </h2>
          <div className="avatar-picker-head-actions">
            {current && (
              <button
                type="button"
                className="btn avatar-picker-remove"
                onClick={() => {
                  onPick(null);
                  dismiss();
                }}
              >
                Remove avatar
              </button>
            )}
            <button
              type="button"
              className="avatar-picker-close"
              onClick={() => dismiss()}
              aria-label="Close"
            >
              <X width={18} height={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </header>

        <div className="avatar-picker-body">
          <SearchPill
            value={query}
            onChange={handleQueryChange}
            placeholder="Search for a card…"
            ariaLabel="Search for a card to use as your avatar"
            autoFocus
            inputProps={{
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': options.length > 0,
              'aria-controls': listboxId,
              'aria-activedescendant':
                options.length > 0 ? `${listboxId}-option-${clampedActive}` : undefined,
              onKeyDown: handleKeyDown,
            }}
          />

          {!searching && collection.length === 0 && (
            <div className="avatar-picker-empty-collection">
              <p>Your collection is empty.</p>
              <p>Search below for any card to use as your avatar.</p>
            </div>
          )}

          {searching && loading && (
            <p className="card-picker-empty" aria-live="polite">
              Searching...
            </p>
          )}
          {searching && error && (
            <p className="card-picker-empty avatar-picker-error" aria-live="polite">
              {error}
            </p>
          )}
          {searching && !loading && !error && results.length === 0 && (
            <p className="card-picker-empty" aria-live="polite">
              No matches.
            </p>
          )}

          {options.length > 0 && (
            <ul
              id={listboxId}
              className="avatar-picker-grid"
              role="listbox"
              aria-label="Avatar options"
            >
              {options.map((option, i) => (
                <AvatarOptionTile
                  key={option.key}
                  id={`${listboxId}-option-${i}`}
                  option={option}
                  active={i === clampedActive}
                  onHover={() => setActiveIndex(i)}
                  onPick={() => pick(option)}
                />
              ))}
            </ul>
          )}

          {/* Both hints render below the still-usable grid (never blocking
              it) — a 1-char query and a >300-card collection can both be
              true at once, and each is an independent, non-contradictory
              fact about what's showing. */}
          {!searching && collection.length > 0 && trimmed.length === 1 && (
            <p className="avatar-picker-hint">Type at least two characters to search.</p>
          )}
          {!searching && browseHasMore && (
            <p className="avatar-picker-hint">
              Showing your first 300 cards — search above for more.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

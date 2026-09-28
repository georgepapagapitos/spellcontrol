import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CtxMenuShell } from '@/components/shared/CtxMenuShell';
import { normalizeTagText } from '../../lib/deck-tags';
import { useMediaQuery } from '../../lib/use-media-query';

/** A move the selection can make; the bulk bar renders the same list. */
export interface DeckBulkAction {
  key: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

type Page = 'root' | 'tag-add' | 'tag-remove';

/**
 * What a right-click on a selected card opens while two or more are selected
 * (T162): the selection's actions, not the one card's. The playtest board's
 * rule ("N cards selected"), in the deck editor. Its moves and Remove are the
 * bulk bar's own list (`actions`); its two tag pages do what the bar's Tag
 * popover does, add an existing or new tag to every selected card, or take
 * one off.
 */
export function DeckSelectionMenu({
  title,
  x,
  y,
  target,
  actions,
  deckTags,
  onTag,
  onClose,
}: {
  /** "3 cards selected", the bulk bar's own count wording. */
  title: string;
  x: number;
  y: number;
  target: Element | null;
  actions: DeckBulkAction[];
  deckTags: string[];
  /** Absent when the deck's tags are read-only: no tag pages. */
  onTag?: (tag: string, add: boolean) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<Page>('root');
  const [draft, setDraft] = useState('');
  const narrow = useMediaQuery('(max-width: 1023px)');

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    fn();
  };

  const body =
    page === 'root' ? (
      <>
        {actions
          .filter((a) => !a.danger)
          .map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className="deck-row-menu-item"
              onClick={run(a.run)}
            >
              {a.label}
            </button>
          ))}
        {onTag && (
          <div className="deck-card-menu-group">
            <p className="deck-card-menu-heading">Tags</p>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              className="deck-row-menu-item deck-card-menu-drill"
              onClick={(e) => {
                e.stopPropagation();
                setPage('tag-add');
              }}
            >
              Add tag
              <ChevronRight width={14} height={14} strokeWidth={1.8} aria-hidden />
            </button>
            {deckTags.length > 0 && (
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                className="deck-row-menu-item deck-card-menu-drill"
                onClick={(e) => {
                  e.stopPropagation();
                  setPage('tag-remove');
                }}
              >
                Remove tag
                <ChevronRight width={14} height={14} strokeWidth={1.8} aria-hidden />
              </button>
            )}
          </div>
        )}
        {actions
          .filter((a) => a.danger)
          .map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className="deck-row-menu-item deck-row-menu-item--danger"
              onClick={run(a.run)}
            >
              {a.label}
            </button>
          ))}
      </>
    ) : (
      <>
        <button
          type="button"
          role="menuitem"
          className="deck-row-menu-item deck-card-menu-back"
          onClick={(e) => {
            e.stopPropagation();
            setPage('root');
          }}
        >
          <ChevronLeft width={14} height={14} strokeWidth={1.8} aria-hidden />
          Back
        </button>
        {deckTags.map((tag) => (
          <button
            key={tag}
            type="button"
            role="menuitem"
            className="deck-row-menu-item"
            onClick={run(() => onTag?.(tag, page === 'tag-add'))}
          >
            {tag}
          </button>
        ))}
        {page === 'tag-add' && (
          <div className="deck-card-menu-new">
            <label className="deck-card-menu-new-label" htmlFor="selection-new-tag">
              New tag
            </label>
            <input
              id="selection-new-tag"
              type="text"
              className="deck-card-menu-new-input"
              value={draft}
              maxLength={40}
              placeholder="Blink"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const tag = normalizeTagText(draft);
                if (!tag) return;
                onClose();
                onTag?.(tag, true);
              }}
            />
          </div>
        )}
      </>
    );

  return (
    <CtxMenuShell
      x={x}
      y={y}
      title={title}
      variant={narrow ? 'sheet' : 'floating'}
      contentKey={page}
      target={target}
      onClose={onClose}
    >
      {/* The count heads the menu the way "In <binder>" heads a card's. */}
      {page === 'root' && <p className="deck-card-menu-heading">{title}</p>}
      {body}
    </CtxMenuShell>
  );
}

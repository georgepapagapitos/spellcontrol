import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { normalizeTagText } from '../../lib/deck-tags';
import {
  deckCardActions,
  tagPickActions,
  tagToggleActions,
  SECTION_ORDER,
  SECTION_TITLES,
  type DeckCardActionCtx,
} from './deck-card-actions';
import type { Row } from './deck-display-rows';

/** Root, or one of the two tag submenu pages. */
export type DeckCardMenuPage = 'root' | 'tag' | 'tag-add';

/**
 * The items of a card's menu, rendered identically wherever the menu opens:
 * the list row's kebab, the grid and stacks tile kebab, and a right-click in
 * any of the three. The chrome around it differs (a ToolbarPopover anchored
 * to the kebab, or CtxMenuShell anchored to the pointer); the items do not.
 *
 * Two pages. The root lists the actions in labelled clusters, because the
 * menu is past a dozen rows and the style guide asks for sections rather than
 * one flat list at that length. The tag page picks which tag files the card,
 * and can name a new one.
 *
 * Page state is the caller's so the floating shell can pass it as `contentKey`
 * and get its re-clamp and focus-into-the-new-page for free.
 */
export function DeckCardMenuBody({
  row,
  ctx,
  deckTags,
  page,
  onPageChange,
  onClose,
}: {
  row: Row;
  ctx: DeckCardActionCtx;
  /** Every tag already used anywhere in this deck, for the tag picker. */
  deckTags: string[];
  page: DeckCardMenuPage;
  onPageChange: (page: DeckCardMenuPage) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const actions = deckCardActions(ctx);

  // 'move' hoists the new tag to primary, so the card lands in that section.
  // 'add' appends, so the card keeps the section it is already in.
  const commitNewTag = (mode: 'move' | 'add') => {
    const tag = normalizeTagText(draft);
    if (!tag || !ctx.onSetRowTags) return;
    const without = row.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    ctx.onSetRowTags(row.slotIds, mode === 'move' ? [tag, ...without] : [...without, tag]);
    setDraft('');
    onClose();
  };

  if ((page === 'tag' || page === 'tag-add') && ctx.onSetRowTags) {
    const adding = page === 'tag-add';
    const rows = adding
      ? tagToggleActions(row, deckTags, ctx.onSetRowTags)
      : tagPickActions(row, deckTags, ctx.onSetRowTags);
    return (
      <>
        <button
          type="button"
          role="menuitem"
          className="deck-row-menu-item deck-card-menu-back"
          onClick={(e) => {
            e.stopPropagation();
            onPageChange('root');
          }}
        >
          <ChevronLeft width={14} height={14} strokeWidth={2} aria-hidden />
          Back
        </button>
        {/* Radio on the move page (a card has ONE section), checkbox on the
            add page (it can carry many tags). The role is the whole
            explanation of what the click will do. */}
        {rows.map((p) => (
          <button
            key={p.key}
            type="button"
            role={adding ? 'menuitemcheckbox' : 'menuitemradio'}
            aria-checked={p.checked}
            className="deck-row-menu-item deck-card-menu-pick"
            onClick={(e) => {
              e.stopPropagation();
              p.run?.();
              onClose();
            }}
          >
            <span className="deck-card-menu-pick-mark" aria-hidden>
              {p.checked && <Check width={13} height={13} strokeWidth={2.5} />}
            </span>
            {p.label}
          </button>
        ))}
        <div className="deck-card-menu-new">
          <label className="deck-card-menu-new-label" htmlFor={`new-tag-${row.name}`}>
            New tag
          </label>
          <input
            id={`new-tag-${row.name}`}
            type="text"
            className="deck-card-menu-new-input"
            value={draft}
            maxLength={40}
            placeholder="Blink"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewTag(adding ? 'add' : 'move');
              }
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {SECTION_ORDER.map((section) => {
        const inSection = actions.filter((a) => a.section === section);
        if (inSection.length === 0) return null;
        return (
          <div className="deck-card-menu-group" key={section}>
            <p className="deck-card-menu-heading">{SECTION_TITLES[section]}</p>
            {inSection.map((action) =>
              action.submenu ? (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  className="deck-row-menu-item deck-card-menu-drill"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(action.submenu === 'add' ? 'tag-add' : 'tag');
                  }}
                >
                  {action.label}
                  <ChevronRight width={14} height={14} strokeWidth={2} aria-hidden />
                </button>
              ) : (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  disabled={action.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                    action.run?.();
                  }}
                >
                  {action.label}
                </button>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

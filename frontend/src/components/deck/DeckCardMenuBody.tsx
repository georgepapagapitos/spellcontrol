import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { normalizeTagText } from '../../lib/deck-tags';
import {
  deckCardActions,
  stackPickActions,
  SECTION_ORDER,
  SECTION_TITLES,
  type DeckCardActionCtx,
} from './deck-card-actions';
import type { Row } from './deck-display-rows';

/**
 * The items of a card's menu, rendered identically wherever the menu opens:
 * the list row's kebab, the grid and stacks tile kebab, and a right-click in
 * any of the three. The chrome around it differs (a ToolbarPopover anchored
 * to the kebab, or CtxMenuShell anchored to the pointer); the items do not.
 *
 * Two pages. The root lists the actions in labelled clusters, because the
 * menu is past a dozen rows and the style guide asks for sections rather than
 * one flat list at that length. The stack page picks which stack the card
 * belongs to, and can name a new one.
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
  /** Every tag already used anywhere in this deck, for the stack picker. */
  deckTags: string[];
  page: 'root' | 'stack';
  onPageChange: (page: 'root' | 'stack') => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const actions = deckCardActions(ctx);

  const commitNewStack = () => {
    const tag = normalizeTagText(draft);
    if (!tag || !ctx.onSetRowTags) return;
    // Hoisted to primary, like picking an existing stack: this row moves
    // there rather than merely gaining a tag.
    ctx.onSetRowTags(row.slotIds, [
      tag,
      ...row.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()),
    ]);
    setDraft('');
    onClose();
  };

  if (page === 'stack' && ctx.onSetRowTags) {
    const picks = stackPickActions(row, deckTags, ctx.onSetRowTags);
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
        {picks.map((p) => (
          <button
            key={p.key}
            type="button"
            role="menuitemradio"
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
          <label className="deck-card-menu-new-label" htmlFor={`new-stack-${row.name}`}>
            New stack
          </label>
          <input
            id={`new-stack-${row.name}`}
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
                commitNewStack();
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
                    onPageChange('stack');
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

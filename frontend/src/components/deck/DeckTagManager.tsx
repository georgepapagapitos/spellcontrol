import { Pencil, Trash2 } from 'lucide-react';
import './DeckTagManager.css';
import { Button, IconButton } from '@/components/shared/Button';
import { InlineRename } from '@/components/shared/InlineRename';

/**
 * "See all tags" + rename/remove, for the deck-wide tag list (E171). Lives
 * inside a `ToolbarPopover` (see DeckDisplay's "Group by tag" banner) — this
 * component is just the panel body, reusing `.toolbar-popover-list`/`-item`
 * so it matches every other toolbar popover's chrome instead of inventing a
 * one-off console. Rename/remove act across the WHOLE deck (all three
 * zones) in one store write each — see `renameDeckTag`/`removeDeckTag`.
 */
export function DeckTagManager({
  tags,
  onRename,
  onRemove,
  onDone,
}: {
  tags: Array<{ tag: string; count: number }>;
  onRename?: (from: string, to: string) => void;
  onRemove?: (tag: string) => void;
  onDone: () => void;
}) {
  if (tags.length === 0) {
    return <p className="deck-tag-manager-empty">No tags yet. Add one from a card's preview.</p>;
  }

  return (
    <div className="deck-tag-manager">
      <h3 className="deck-tag-manager-title">Tags in this deck</h3>
      <ul className="toolbar-popover-list deck-tag-manager-list">
        {tags.map(({ tag, count }) => (
          <li key={tag} className="deck-tag-manager-row">
            {onRename ? (
              <InlineRename
                value={tag}
                onCommit={(next) => onRename(tag, next)}
                label={`Rename tag "${tag}"`}
                renameLabel={`Rename "${tag}"`}
                maxLength={40}
                className="deck-tag-manager-name-btn"
                inputClassName="deck-tag-manager-input"
                icon={<Pencil width={13} height={13} strokeWidth={2.2} aria-hidden />}
              />
            ) : (
              <span className="deck-tag-manager-name">{tag}</span>
            )}
            <span className="deck-tag-manager-count">{count}</span>
            {onRemove && (
              <IconButton
                className="deck-tag-manager-icon-btn deck-tag-manager-remove"
                title="Remove from every card"
                onClick={() => onRemove(tag)}
                label={`Remove "${tag}" from every card`}
                icon={<Trash2 width={13} height={13} strokeWidth={2.2} />}
              />
            )}
          </li>
        ))}
      </ul>
      <Button onClick={onDone} className="deck-tag-manager-done">
        Done
      </Button>
    </div>
  );
}

import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import './DeckTagManager.css';

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
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (from: string) => {
    const to = draft.trim();
    if (to && to !== from) onRename?.(from, to);
    setEditing(null);
  };

  if (tags.length === 0) {
    return <p className="deck-tag-manager-empty">No tags yet — add one from a card's preview.</p>;
  }

  return (
    <div className="deck-tag-manager">
      <h3 className="deck-tag-manager-title">Tags in this deck</h3>
      <ul className="toolbar-popover-list deck-tag-manager-list">
        {tags.map(({ tag, count }) => (
          <li key={tag} className="deck-tag-manager-row">
            {editing === tag ? (
              <>
                <input
                  autoFocus
                  type="text"
                  className="deck-tag-manager-input"
                  value={draft}
                  maxLength={40}
                  aria-label={`Rename tag "${tag}"`}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(tag);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <button
                  type="button"
                  className="deck-tag-manager-icon-btn"
                  aria-label={`Save new name for "${tag}"`}
                  onClick={() => commitRename(tag)}
                >
                  <Check width={14} height={14} strokeWidth={2.4} aria-hidden />
                </button>
                <button
                  type="button"
                  className="deck-tag-manager-icon-btn"
                  aria-label="Cancel rename"
                  onClick={() => setEditing(null)}
                >
                  <X width={14} height={14} strokeWidth={2.4} aria-hidden />
                </button>
              </>
            ) : (
              <>
                <span className="deck-tag-manager-name">{tag}</span>
                <span className="deck-tag-manager-count">{count}</span>
                {onRename && (
                  <button
                    type="button"
                    className="deck-tag-manager-icon-btn"
                    aria-label={`Rename "${tag}"`}
                    title="Rename"
                    onClick={() => {
                      setDraft(tag);
                      setEditing(tag);
                    }}
                  >
                    <Pencil width={13} height={13} strokeWidth={2.2} aria-hidden />
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    className="deck-tag-manager-icon-btn deck-tag-manager-remove"
                    aria-label={`Remove "${tag}" from every card`}
                    title="Remove from every card"
                    onClick={() => onRemove(tag)}
                  >
                    <Trash2 width={13} height={13} strokeWidth={2.2} aria-hidden />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm deck-tag-manager-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { useDecksStore } from '../store/decks';
import { buildCommands, flattenGroups, matchCommands } from '../lib/commands';
import './CommandPalette.css';

interface Props {
  onClose: () => void;
}

/**
 * ⌘K command palette (v1) — navigation, decks by name, and the few actions
 * that are real destinations.
 *
 * Built on `<Modal>` rather than a bespoke overlay so it inherits the whole
 * overlay contract for free: shared layer stack, Escape, Android hardware
 * back, focus trap and focus restore (see `project_overlay_contract`).
 *
 * Keyboard model is the standard combobox one: focus never leaves the input,
 * and the active option is published via `aria-activedescendant`. Roving
 * tabindex would fight Modal's Tab trap and cost the user their query.
 */
export function CommandPalette({ onClose }: Props): JSX.Element {
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo(
    () =>
      buildCommands({
        decks,
        go: (path, state) => {
          onClose();
          navigate(path, state ? { state } : undefined);
        },
      }),
    [decks, navigate, onClose]
  );

  const groups = useMemo(() => matchCommands(commands, query), [commands, query]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  // A new query re-ranks everything, so the old index points at a different
  // command — reset rather than leave the highlight somewhere arbitrary.
  // Adjusted during render, not in an effect: an effect would paint one frame
  // with the stale row highlighted, and `react-hooks/set-state-in-effect`
  // rightly rejects it.
  const [queryAtReset, setQueryAtReset] = useState(query);
  if (query !== queryAtReset) {
    setQueryAtReset(query);
    setActive(0);
  }

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[active]?.run();
    }
  };

  const activeId = flat[active] ? `cmdk-opt-${flat[active].id}` : undefined;

  return (
    <Modal onClose={onClose} className="command-palette" label="Command palette">
      <div className="cmdk-input-row">
        <Search width={18} height={18} strokeWidth={2} aria-hidden />
        <input
          autoFocus
          type="text"
          className="cmdk-input"
          placeholder="Search pages, decks and actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls="cmdk-list"
          aria-activedescendant={activeId}
          aria-label="Search pages, decks and actions"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef} aria-label="Commands">
        {groups.length === 0 ? (
          <p className="cmdk-empty">No matches for “{query.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <div className="cmdk-group" key={group.group}>
              <p className="cmdk-group-title" aria-hidden>
                {group.group}
              </p>
              {group.commands.map((command) => {
                const index = flat.indexOf(command);
                const isActive = index === active;
                return (
                  <button
                    key={command.id}
                    id={`cmdk-opt-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    className="cmdk-option"
                    // Pointer-move, not enter: a list scrolling under a
                    // stationary cursor would otherwise steal the highlight
                    // from the key the user just pressed.
                    onPointerMove={() => setActive(index)}
                    onClick={() => command.run()}
                    tabIndex={-1}
                  >
                    <span className="cmdk-option-label">{command.label}</span>
                    {command.hint && <span className="cmdk-option-hint">{command.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <p className="cmdk-footer" aria-hidden>
        <kbd>↑</kbd>
        <kbd>↓</kbd> to navigate · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
      </p>
    </Modal>
  );
}

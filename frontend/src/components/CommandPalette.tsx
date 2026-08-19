import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Modal } from './Modal';
import { useDecksStore } from '../store/decks';
import { useAiStatus } from '../lib/use-ai-status';
import { useSearchCards } from '../lib/use-search-cards';
import { useCardCarousel } from './deck/useCardCarousel';
import {
  buildCommands,
  flattenGroups,
  matchCommands,
  type Command,
  type CommandGroupResult,
} from '../lib/commands';
import './CommandPalette.css';

interface Props {
  onClose: () => void;
}

/**
 * ⌘K command palette (v1 + E247 lane 2) — navigation, decks by name, actions,
 * self-hiding AI commands, and an async Scryfall card lane.
 *
 * Built on `<Modal>` rather than a bespoke overlay so it inherits the whole
 * overlay contract for free: shared layer stack, Escape, Android hardware
 * back, focus trap and focus restore (see `project_overlay_contract`).
 *
 * Keyboard model is the standard combobox one: focus never leaves the input,
 * and the active option is published via `aria-activedescendant`. Roving
 * tabindex would fight Modal's Tab trap and cost the user their query.
 *
 * The Cards group is asynchronous: `useSearchCards` supplies the debounce /
 * loading / error / cancellation machinery every other search box here uses,
 * and results render as ordinary option rows appended after the sync groups —
 * so arrow keys and Enter need no special casing. Picking a card opens the
 * shared card carousel ON TOP of the palette (the overlay stack handles the
 * layering), so several results can be previewed without retyping the query.
 */
export function CommandPalette({ onClose }: Props): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const decks = useDecksStore((s) => s.decks);
  const aiStatus = useAiStatus();
  const carousel = useCardCarousel('Card search');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Deck-scoped AI commands exist only while a real deck page is open —
  // `/decks/new` matches the pattern but resolves to no deck, so it's excluded
  // by construction.
  const deckPage = useMemo(() => {
    const id = matchPath('/decks/:deckId', location.pathname)?.params.deckId;
    const deck = id ? decks.find((d) => d.id === id) : undefined;
    return deck ? { id: deck.id, name: deck.name } : null;
  }, [location.pathname, decks]);

  const commands = useMemo(
    () =>
      buildCommands({
        decks,
        aiAvailable: !!aiStatus,
        deckPage,
        go: (path, state) => {
          onClose();
          navigate(path, state ? { state } : undefined);
        },
      }),
    [decks, aiStatus, deckPage, navigate, onClose]
  );

  const groups = useMemo(() => matchCommands(commands, query), [commands, query]);

  // The async card lane. The hook stays idle under 2 characters and debounces
  // above it; results become ordinary Command rows so the keyboard model is
  // untouched. Opening a card does NOT close the palette — the carousel stacks
  // on top, and Escape unwinds one layer at a time.
  const searching = query.trim().length >= 2;
  const { results, loading, error } = useSearchCards(query, 6);
  const cardCommands = useMemo<Command[]>(() => {
    const entries = results.map((c) => ({ name: c.name, label: 'Search result', card: c }));
    return results.map((c) => ({
      id: `card:${c.id}`,
      label: c.name,
      group: 'Cards' as const,
      hint: c.type_line ?? undefined,
      run: () => carousel.open(entries, c.name),
    }));
  }, [results, carousel]);

  const renderGroups = useMemo<CommandGroupResult[]>(
    () =>
      cardCommands.length > 0 && searching
        ? [...groups, { group: 'Cards' as const, commands: cardCommands }]
        : groups,
    [groups, cardCommands, searching]
  );
  const flat = useMemo(() => flattenGroups(renderGroups), [renderGroups]);

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

  // The card lane still owes the reader a line while it has no rows: searching,
  // failed, or (when nothing else matched either) genuinely empty.
  const cardsPending = searching && cardCommands.length === 0 && (loading || error !== null);
  const empty = renderGroups.length === 0 && !cardsPending;

  return (
    <Modal onClose={onClose} className="command-palette" label="Command palette">
      <div className="cmdk-input-row">
        <Search width={16} height={16} strokeWidth={2} aria-hidden />
        <input
          autoFocus
          type="text"
          className="cmdk-input"
          placeholder="Search pages, decks, cards and actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls="cmdk-list"
          aria-activedescendant={activeId}
          aria-label="Search pages, decks, cards and actions"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef} aria-label="Commands">
        {empty ? (
          <p className="cmdk-empty">No matches for “{query.trim()}”.</p>
        ) : (
          <>
            {renderGroups.map((group) => (
              <div className="cmdk-group" key={group.group} role="group" aria-label={group.group}>
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
            ))}
            {cardsPending && (
              <div className="cmdk-group">
                <p className="cmdk-group-title" aria-hidden>
                  Cards
                </p>
                <p className="cmdk-status" role="status">
                  {loading ? 'Searching cards…' : error}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <p className="cmdk-footer" aria-hidden>
        <kbd>↑</kbd>
        <kbd>↓</kbd> to navigate · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
      </p>
      {carousel.preview}
    </Modal>
  );
}

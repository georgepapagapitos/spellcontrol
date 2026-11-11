import './IdeaSearchBox.css';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SearchPill } from '@/components/search/SearchPill';
import { Chip } from '@/components/shared/Chip';
import {
  ideaKindLabel,
  matchCommanderNames,
  nearestIdeas,
  searchIdeas,
  type Idea,
  type IdeaIndex,
} from '@/lib/deck/idea-index';
import { formatCount } from '@/lib/util/format-count';

type Option =
  { kind: 'idea'; key: string; idea: Idea } | { kind: 'commander'; key: string; name: string };

interface Props {
  /** The closed idea list; null while it loads, when the box still searches commanders. */
  index: IdeaIndex | null;
  /** Commander names for the typeahead; an optional second source. */
  commanderNames: readonly string[] | null;
  ownedNames: ReadonlySet<string>;
  text: string;
  onText: (next: string) => void;
  idea: Idea | null;
  onIdea: (idea: Idea | null) => void;
  /** Picks a commander by name. Rejects when the card can't be loaded. */
  onPickCommander: (name: string) => Promise<void>;
  nouns: string;
}

/**
 * The finder's one search box (E1113). Plain text narrows the grid below it as before; the
 * same text also suggests deck ideas and commanders, and picking an idea puts it in the box as
 * a removable chip, so an idea is a filter on the grid and never a second place to browse.
 * The popup only acts on a highlighted option: Enter with nothing highlighted keeps typing
 * a search rather than choosing for the player.
 */
export function IdeaSearchBox({
  index,
  commanderNames,
  ownedNames,
  text,
  onText,
  idea,
  onIdea,
  onPickCommander,
  nouns,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const query = text.trim();
  const found = useMemo(() => {
    if (!query) return null;
    const ideas = index ? searchIdeas(index, query).filter((i) => i.slug !== idea?.slug) : [];
    const commanders = commanderNames ? matchCommanderNames(commanderNames, query) : [];
    return { ideas, commanders };
  }, [index, query, commanderNames, idea]);
  // Nothing matched an idea: offer the nearest, so a miss still shows what the list holds.
  const near = useMemo(
    () =>
      found && index && found.ideas.length === 0 && found.commanders.length === 0
        ? nearestIdeas(index, query)
        : null,
    [found, index, query]
  );

  const options: Option[] = useMemo(() => {
    if (!found) return [];
    const list = near ? near.ideas : found.ideas;
    return [
      ...list.map((i): Option => ({ kind: 'idea', key: `i-${i.slug}`, idea: i })),
      ...found.commanders.map((name): Option => ({ kind: 'commander', key: `c-${name}`, name })),
    ];
  }, [found, near]);

  const showPopup = open && found !== null && options.length > 0;
  const activeIndex = showPopup && highlight >= 0 ? Math.min(highlight, options.length - 1) : -1;
  const optionId = (i: number) => `${listboxId}-option-${i}`;

  const pick = async (o: Option) => {
    setOpen(false);
    setHighlight(-1);
    if (o.kind === 'idea') {
      onIdea(o.idea);
      onText('');
      return;
    }
    setPicking(o.name);
    setPickError(null);
    try {
      await onPickCommander(o.name);
    } catch {
      setPickError(`Couldn't load ${o.name}. Try again.`);
    }
    setPicking(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (options.length > 0) setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length > 0) setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex < 0) return;
      e.preventDefault();
      void pick(options[activeIndex]);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (!text && idea) {
        onIdea(null);
      }
    } else if (e.key === 'Backspace' && !text && idea) {
      onIdea(null);
    }
  };

  const status =
    !query || !showPopup
      ? ''
      : `${options.length} ${options.length === 1 ? 'suggestion' : 'suggestions'}`;
  const ideaOptions = options.filter((o) => o.kind === 'idea');
  const commanderOptions = options.filter((o) => o.kind === 'commander');
  const indexOf = (o: Option) => options.indexOf(o);

  return (
    <div className="idea-search" ref={wrapperRef}>
      <div className="idea-field">
        {idea && (
          <Chip
            className="idea-field-chip"
            removeClassName="idea-field-chip-remove"
            tone="accent"
            removeLabel={`Remove ${idea.name}`}
            onRemove={() => onIdea(null)}
          >
            {idea.kind === 'typal' ? 'Leads' : 'Built around'} {idea.name}
          </Chip>
        )}
        <SearchPill
          className="idea-field-input commander-finder-search"
          inputType="text"
          placeholder={idea ? 'Narrow by name' : 'Commander, creature type or theme'}
          value={text}
          onChange={(next) => {
            onText(next);
            setOpen(true);
            setHighlight(-1);
            setPickError(null);
          }}
          ariaLabel={`Search ${nouns} by name, type or rules text, or pick a creature type or theme`}
          inputProps={{
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': showPopup,
            'aria-controls': listboxId,
            'aria-activedescendant': activeIndex >= 0 ? optionId(activeIndex) : undefined,
            autoComplete: 'off',
            spellCheck: false,
            onFocus: () => setOpen(true),
            onKeyDown,
          }}
        />
      </div>
      <p className="sr-only" role="status">
        {status}
      </p>
      {showPopup && (
        <div className="idea-search-popup" data-surface="popover">
          {near && (
            <p className="idea-search-nomatch">
              {near.fallback
                ? `No deck idea called “${query}”. These are popular instead.`
                : `No deck idea called “${query}”. These are the closest.`}
            </p>
          )}
          <div
            id={listboxId}
            role="listbox"
            aria-label="Deck ideas and commanders"
            className="idea-search-options"
          >
            {ideaOptions.length > 0 && (
              <ul
                role="group"
                aria-labelledby={`${listboxId}-ideas`}
                className="idea-search-groupbox"
              >
                <li id={`${listboxId}-ideas`} className="idea-search-group" role="presentation">
                  {near ? 'Closest ideas' : 'Deck ideas'}
                </li>
                {ideaOptions.map((o) => (
                  <OptionRow
                    key={o.key}
                    id={optionId(indexOf(o))}
                    active={indexOf(o) === activeIndex}
                    onHover={() => setHighlight(indexOf(o))}
                    onPick={() => void pick(o)}
                    name={o.kind === 'idea' ? o.idea.name : ''}
                    note={
                      o.kind === 'idea'
                        ? `${ideaKindLabel(o.idea.kind)} · ${formatCount(o.idea.decks)} decks`
                        : ''
                    }
                  />
                ))}
              </ul>
            )}
            {commanderOptions.length > 0 && (
              <ul
                role="group"
                aria-labelledby={`${listboxId}-commanders`}
                className="idea-search-groupbox"
              >
                <li
                  id={`${listboxId}-commanders`}
                  className="idea-search-group"
                  role="presentation"
                >
                  Commanders
                </li>
                {commanderOptions.map((o) => (
                  <OptionRow
                    key={o.key}
                    id={optionId(indexOf(o))}
                    active={indexOf(o) === activeIndex}
                    onHover={() => setHighlight(indexOf(o))}
                    onPick={() => void pick(o)}
                    name={o.kind === 'commander' ? o.name : ''}
                    note={
                      o.kind === 'commander' && ownedNames.has(o.name.toLowerCase())
                        ? 'In collection'
                        : ''
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {picking && (
        <p className="idea-start-status" role="status">
          Loading {picking}…
        </p>
      )}
      {pickError && (
        <p className="idea-start-error" role="alert">
          {pickError}
        </p>
      )}
    </div>
  );
}

function OptionRow({
  id,
  active,
  name,
  note,
  onHover,
  onPick,
}: {
  id: string;
  active: boolean;
  name: string;
  note: string;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      className={`idea-search-option${active ? ' is-highlight' : ''}`}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
    >
      <span className="idea-search-option-name">{name}</span>
      {note && <span className="idea-search-option-note">{note}</span>}
    </li>
  );
}

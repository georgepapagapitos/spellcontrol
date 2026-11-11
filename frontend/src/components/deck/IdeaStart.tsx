import './IdeaStart.css';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchPill } from '@/components/search/SearchPill';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { fetchAllCommanderNames } from '@/deck-builder/services/edhrec/client';
import type { DeckFormat } from '@/deck-builder/types';
import { ideaPagePath } from '@/lib/deck/idea-handoff';
import {
  collectionCouldBuild,
  ideaKindLabel,
  matchCommanderNames,
  nearestIdeas,
  ownedTypeCounts,
  searchIdeas,
  useIdeaIndex,
  type Idea,
  type IdeaIndex,
} from '@/lib/deck/idea-index';
import { MIN_COLLECTION_SIZE } from '@/lib/deck/commander-readiness';
import { formatCount } from '@/lib/util/format-count';
import { useCollectionStore } from '@/store/collection';
import { IdeaTile } from './IdeaTile';

/** Creature types and ways to play shown on the shelves; the rest are behind "Browse every idea". */
const TYPE_SHELF = 12;
const PLAY_SHELF = 8;

type Option =
  { kind: 'idea'; key: string; idea: Idea } | { kind: 'commander'; key: string; name: string };

interface Props {
  format: DeckFormat;
  /** Picks a commander by name. Rejects when the card can't be loaded. */
  onPickCommander: (name: string) => Promise<void>;
}

/**
 * "What do you want to build?" (E1112): a closed list of deck ideas, creature types and
 * ways to play, searched or browsed, each leading to a page of the commanders that lead it.
 * Typed text only filters the list (and the commander names), so nothing free-form starts a
 * build. The snapshot loads with this section, not with the app.
 */
export function IdeaStart({ format, onPickCommander }: Props) {
  const state = useIdeaIndex();
  const headingId = useId();
  return (
    <section className="deck-builder-section idea-start" aria-labelledby={headingId}>
      <h2 className="deck-builder-section-title" id={headingId}>
        What do you want to build?
      </h2>
      {state.status === 'loading' && (
        <p className="idea-start-status" role="status">
          Loading ideas…
        </p>
      )}
      {state.status === 'error' && (
        <EmptyState compact as="div" className="idea-start-status" status>
          Couldn't load the deck ideas.{' '}
          <Button variant="link" onClick={state.retry}>
            Retry
          </Button>
        </EmptyState>
      )}
      {state.status === 'ready' && (
        <IdeaStartReady index={state.index} format={format} onPickCommander={onPickCommander} />
      )}
    </section>
  );
}

function IdeaStartReady({ index, format, onPickCommander }: Props & { index: IdeaIndex }) {
  const navigate = useNavigate();
  const collection = useCollectionStore((s) => s.cards);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const [commanderNames, setCommanderNames] = useState<string[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const listboxId = useId();
  const allId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLDivElement>(null);

  // The typeahead's commander list is a second, optional source: without it the box still
  // finds ideas.
  useEffect(() => {
    let cancelled = false;
    fetchAllCommanderNames()
      .then((names) => {
        if (!cancelled) setCommanderNames(names);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const ownedNames = useMemo(
    () => new Set(collection.map((c) => c.name.toLowerCase())),
    [collection]
  );

  const query = text.trim();
  const found = useMemo(() => {
    if (!query) return null;
    const ideas = searchIdeas(index, query);
    const commanders = commanderNames ? matchCommanderNames(commanderNames, query) : [];
    if (ideas.length > 0 || commanders.length > 0) {
      return { ideas, commanders, near: null as ReturnType<typeof nearestIdeas> | null };
    }
    return { ideas: [], commanders: [], near: nearestIdeas(index, query) };
  }, [index, query, commanderNames]);

  const options: Option[] = useMemo(() => {
    if (!found) return [];
    const list = found.near ? found.near.ideas : found.ideas;
    return [
      ...list.map((idea): Option => ({ kind: 'idea', key: `i-${idea.slug}`, idea })),
      ...found.commanders.map((name): Option => ({ kind: 'commander', key: `c-${name}`, name })),
    ];
  }, [found]);

  const showPopup = open && found !== null;
  const activeIndex = showPopup && highlight >= 0 ? Math.min(highlight, options.length - 1) : -1;
  const optionId = (i: number) => `${listboxId}-option-${i}`;

  const goToIdea = (idea: Idea) => navigate(ideaPagePath(idea.slug, format));

  const pick = async (o: Option) => {
    if (o.kind === 'idea') {
      goToIdea(o.idea);
      return;
    }
    setOpen(false);
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
      if (!showPopup || options.length === 0) return;
      e.preventDefault();
      // Nothing highlighted: take the top result, the one the list leads with.
      void pick(options[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const browseAll = () => {
    setOpen(false);
    setShowAll(true);
    // After the list mounts, bring it into view and let a keyboard user continue from it.
    requestAnimationFrame(() => allRef.current?.focus());
  };

  const typal = useMemo(() => index.ideas.filter((i) => i.kind === 'typal'), [index]);
  const playstyles = useMemo(() => index.ideas.filter((i) => i.kind === 'playstyle'), [index]);
  const counts = useMemo(
    () => (collection.length >= MIN_COLLECTION_SIZE ? ownedTypeCounts(collection, typal) : null),
    [collection, typal]
  );
  const couldBuild = useMemo(
    () => (counts ? collectionCouldBuild(counts, index) : []),
    [counts, index]
  );

  const status = !query
    ? ''
    : found?.near
      ? 'No exact match. Showing the closest ideas.'
      : `${options.length} ${options.length === 1 ? 'result' : 'results'}`;

  const ideaOptions = options.filter((o) => o.kind === 'idea');
  const commanderOptions = options.filter((o) => o.kind === 'commander');
  const indexOf = (o: Option) => options.indexOf(o);

  return (
    <>
      <p className="idea-start-hint">
        A creature type or a way to play. Type angels, landfall or a commander's name.
      </p>
      <div className="idea-search" ref={wrapperRef}>
        <SearchPill
          className="idea-search-field"
          inputType="text"
          value={text}
          onChange={(next) => {
            setText(next);
            setOpen(true);
            setHighlight(-1);
            setPickError(null);
          }}
          placeholder="Search creature types, themes and commanders"
          ariaLabel="Search deck ideas and commanders"
          inputProps={{
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': showPopup && options.length > 0,
            'aria-controls': listboxId,
            'aria-activedescendant': activeIndex >= 0 ? optionId(activeIndex) : undefined,
            autoComplete: 'off',
            spellCheck: false,
            onFocus: () => setOpen(true),
            onKeyDown,
          }}
        />
        <p className="sr-only" role="status">
          {status}
        </p>
        {showPopup && (
          <div className="idea-search-popup" data-surface="popover">
            {found.near && (
              <p className="idea-search-nomatch">
                {found.near.fallback
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
                    {found.near ? 'Closest ideas' : 'Deck ideas'}
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
            {found.near && (
              <p className="idea-search-foot">
                Not it?{' '}
                <Button variant="link" onClick={browseAll}>
                  Browse every idea
                </Button>
              </p>
            )}
          </div>
        )}
      </div>
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

      {couldBuild.length > 0 && (
        <Shelf
          title="Your collection could build"
          hint="Creature types you already own many cards of."
        >
          {couldBuild.map(({ idea, owned }) => (
            <IdeaTile
              key={idea.slug}
              idea={idea}
              owned={owned}
              to={ideaPagePath(idea.slug, format)}
            />
          ))}
        </Shelf>
      )}
      <Shelf title="Creature types">
        {typal.slice(0, TYPE_SHELF).map((idea) => (
          <IdeaTile key={idea.slug} idea={idea} to={ideaPagePath(idea.slug, format)} />
        ))}
      </Shelf>
      <Shelf title="Ways to play">
        {playstyles.slice(0, PLAY_SHELF).map((idea) => (
          <IdeaTile key={idea.slug} idea={idea} to={ideaPagePath(idea.slug, format)} />
        ))}
      </Shelf>

      <p className="idea-start-all-toggle">
        <Button
          variant="link"
          aria-expanded={showAll}
          aria-controls={allId}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Hide the full list' : `Browse every idea (${index.ideas.length})`}
        </Button>
      </p>
      <div id={allId} ref={allRef} tabIndex={-1} className="idea-all" hidden={!showAll}>
        {showAll && (
          <>
            <AllGroup title="Creature types" ideas={typal} format={format} />
            <AllGroup title="Ways to play" ideas={playstyles} format={format} />
          </>
        )}
      </div>
    </>
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

function Shelf({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="idea-shelf" aria-labelledby={id}>
      <h3 className="idea-shelf-title" id={id}>
        {title}
      </h3>
      {hint && <p className="idea-shelf-hint">{hint}</p>}
      <div className="idea-shelf-grid">{children}</div>
    </section>
  );
}

function AllGroup({ title, ideas, format }: { title: string; ideas: Idea[]; format: DeckFormat }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 className="idea-shelf-title" id={id}>
        {title}
      </h3>
      <ul className="idea-all-list">
        {ideas.map((idea) => (
          <li key={idea.slug}>
            <Button variant="link" to={ideaPagePath(idea.slug, format)}>
              {idea.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

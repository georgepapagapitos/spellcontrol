import './BrowseRails.css';
import './EdhrecSource.css';
import { useCallback, useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { SwipeRow } from '@/components/shared/SwipeRow';
import {
  BROWSE_LISTS,
  isOwnedName,
  loadBrowseList,
  type BrowseItem,
  type BrowseListDef,
  type BrowseListId,
  type EdhrecProvenance,
} from '@/lib/browse-lists';
import { formatRelativeTime } from '@/lib/format-time';
import { useOnline } from '@/lib/use-online';
import { userMessage } from '@/lib/user-error';
import { useOwnedNames } from '@/lib/use-owned-names';
import { BrowseTile, BrowseTileSkeleton } from './BrowseTile';
import { useBrowsePreview } from './use-browse-preview';

/** Tiles per rail. A phone swipes through all of them; the desktop grid shows
 *  the first six (BrowseRails.css) and "See all" has the rest. */
const RAIL_SIZE = 10;
const RAIL_COLUMNS = 6;

type RailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; items: BrowseItem[] };

/** Lists with a number under every tile reserve the caption line while loading. */
const HAS_STAT: Record<BrowseListId, boolean> = {
  commanders: true,
  'new-commanders': true,
  cards: true,
  salt: true,
  'game-changers': false,
  banned: false,
};

function BrowseRail({
  def,
  online,
  owned,
  onProvenance,
}: {
  def: BrowseListDef;
  online: boolean;
  owned: ReadonlySet<string>;
  onProvenance: (id: BrowseListId, provenance: EdhrecProvenance) => void;
}) {
  const headingId = useId();
  const [state, setState] = useState<RailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const preview = useBrowsePreview(def);
  // A popularity list lives on a server; without a connection there is
  // nothing to ask, so the rail stands aside for the page's one offline line.
  const skip = def.needsNetwork && !online;

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    loadBrowseList(def.id).then(
      (page) => {
        if (cancelled) return;
        setState({ status: 'done', items: page.items.slice(0, RAIL_SIZE) });
        if (page.edhrec) onProvenance(def.id, page.edhrec);
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: userMessage(err, "Couldn't load this list.") });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [def.id, skip, attempt, onProvenance]);

  if (skip) return null;
  // Offline, a list that isn't in the local card data fails quietly: the
  // offline line already says why.
  if (state.status === 'error' && !online) return null;
  if (state.status === 'done' && state.items.length === 0) return null;

  const head = (
    <SectionHeader
      id={headingId}
      title={def.railTitle}
      meta={def.railMeta && <span className="browse-rail-meta">{def.railMeta}</span>}
      className="browse-rail-head"
      tools={
        <Button
          variant="link"
          to={`/search/top/${def.id}`}
          aria-label={`See all ${def.title.toLowerCase()}`}
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          See all
        </Button>
      }
    />
  );

  if (state.status === 'loading') {
    return (
      <section className="browse-rail" aria-labelledby={headingId} aria-busy="true">
        {head}
        <p role="status" className="sr-only">
          Loading {def.title.toLowerCase()}…
        </p>
        <SwipeRow className="browse-rail-row" columns={RAIL_COLUMNS} tile="card" aria-hidden="true">
          {Array.from({ length: RAIL_SIZE }, (_, i) => (
            <li key={i}>
              <BrowseTileSkeleton caption={HAS_STAT[def.id]} />
            </li>
          ))}
        </SwipeRow>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="browse-rail" aria-labelledby={headingId}>
        {head}
        <div className="discover-decks-error" role="alert">
          <span>{state.message}</span>
          <Button
            className="discover-decks-error-retry"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const items = state.items;
  return (
    <section className="browse-rail" aria-labelledby={headingId}>
      {head}
      <SwipeRow
        className="browse-rail-row"
        columns={RAIL_COLUMNS}
        tile="card"
        aria-labelledby={headingId}
      >
        {items.map((item) => (
          <li key={item.name}>
            <BrowseTile
              list={def.id}
              item={item}
              owned={isOwnedName(owned, item.name)}
              onOpen={() => preview.open(items, item.name)}
            />
          </li>
        ))}
      </SwipeRow>
      {preview.preview}
    </section>
  );
}

/** The sources line under the rails: who each list's numbers belong to, and
 *  how old our copy of EDHREC's lists is (the oldest of them, so the line
 *  never makes a list sound fresher than it is). */
function BrowseSources({ edhrec }: { edhrec: EdhrecProvenance[] }) {
  const oldest = edhrec.reduce<EdhrecProvenance | null>(
    (acc, p) => (!acc || p.fetchedAt < acc.fetchedAt ? p : acc),
    null
  );
  const stale = edhrec.some((p) => p.stale);
  const when = oldest ? formatRelativeTime(oldest.fetchedAt, { verbose: true }) : null;
  return (
    <p className="browse-source browse-rails-sources">
      Popularity and salt from{' '}
      <a href="https://edhrec.com" target="_blank" rel="noopener noreferrer" className="text-link">
        EDHREC
      </a>
      {when &&
        (stale
          ? `, which couldn't be reached, so its lists are from ${when}`
          : `, updated ${when}`)}
      . Game Changers, bans and new commanders from{' '}
      <a
        href="https://scryfall.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-link"
      >
        Scryfall
      </a>
      .
    </p>
  );
}

/**
 * The Search page's landing: one rail per browse list (lib/browse-lists.ts),
 * each a row of the list's top cards with a door to the full list.
 */
export function BrowseRails() {
  const online = useOnline();
  const owned = useOwnedNames();
  const [edhrec, setEdhrec] = useState<Partial<Record<BrowseListId, EdhrecProvenance>>>({});
  const onProvenance = useCallback(
    (id: BrowseListId, p: EdhrecProvenance) => setEdhrec((prev) => ({ ...prev, [id]: p })),
    []
  );

  return (
    <div className="browse-rails">
      {!online && <p className="browse-offline">Popular and new card lists need a connection.</p>}
      {BROWSE_LISTS.map((def) => (
        <BrowseRail
          key={def.id}
          def={def}
          online={online}
          owned={owned}
          onProvenance={onProvenance}
        />
      ))}
      <BrowseSources edhrec={Object.values(edhrec)} />
    </div>
  );
}

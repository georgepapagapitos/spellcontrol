import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fetchTagPageData } from '@/deck-builder/services/edhrec/client';
import type { EDHRECTopCommander } from '@/deck-builder/types';
import { Button } from '@/components/shared/Button';
import { Disclosure } from '@/components/shared/form';
import { colorComboName } from '@/lib/deck/commander-finder';
import {
  computeCollectionLeans,
  LEAN_COLOR_WORD,
  rankByCoverage,
  type Lean,
} from '@/lib/deck/collection-leans';
import type { ReadinessScore } from '@/lib/deck/commander-readiness';
import type { EnrichedCard } from '@/types/index';
import { CommanderResultCard } from './CommanderResultCard';

/** Commanders scored per lean (the page lists up to 18), so a lean costs at most this many fetches. */
const POOL = 8;
/** Commanders shown per lean. */
const SHOWN = 4;
/** Staple fetches in flight at once. */
const CONCURRENCY = 4;

type Readiness = Map<string, ReadinessScore | 'loading'>;

interface Props {
  cards: readonly EnrichedCard[];
  /** Colors the finder is narrowed to; empty means no narrowing. */
  colors: ReadonlySet<string>;
  readiness: Readiness;
  /** The finder's own coverage loader, so a lean scores the way the grid does. */
  ensureReadiness: (name: string) => Promise<void>;
  isOwned: (name: string) => boolean;
  selectingName: string | null;
  onPick: (name: string) => void;
}

const leanName = (l: Lean) => `${LEAN_COLOR_WORD[l.color]} ${l.label.toLowerCase()}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "What your collection leans toward" (E284): the EDHREC theme pages each color
 * of your cards skews to, with that page's commanders ranked by how much of
 * their deck you own. The leans come from the cards alone, instantly; nothing
 * is fetched until the disclosure is opened, and then only the top few pages.
 */
export function CommanderLeans({ cards, colors, ...rest }: Props) {
  const leans = useMemo(
    () => computeCollectionLeans(cards).filter((l) => colors.size === 0 || colors.has(l.color)),
    [cards, colors]
  );
  if (leans.length === 0) return null;
  return (
    <div className="commander-finder-leans">
      <Disclosure
        title="What your collection leans toward"
        summary={capital(leans.map(leanName).join(', '))}
      >
        <p className="commander-finder-hint">
          Commanders from EDHREC's theme pages for each lean, ranked by how much of their deck you
          own.
        </p>
        {leans.map((l) => (
          <LeanGroup key={`${l.color}-${l.slug}`} lean={l} {...rest} />
        ))}
      </Disclosure>
    </div>
  );
}

type PageState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'none' }
  | { status: 'ready'; pool: EDHRECTopCommander[] };

function LeanGroup({
  lean,
  readiness,
  ensureReadiness,
  isOwned,
  selectingName,
  onPick,
}: Omit<Props, 'cards' | 'colors'> & { lean: Lean }) {
  const headingId = useId();
  const name = leanName(lean);
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [scored, setScored] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ensureRef = useRef(ensureReadiness);
  useEffect(() => {
    ensureRef.current = ensureReadiness;
  }, [ensureReadiness]);

  // Opening the disclosure mounts this: one tag page (cached per tag and color
  // by the EDHREC client), then the top few commanders' staples, four at a time.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPage({ status: 'loading' });
      setScored(false);
      try {
        const data = await fetchTagPageData(lean.slug, [lean.color]);
        if (cancelled) return;
        // A missing color page falls back to the all-colors list, which is no
        // answer for this color.
        if (!data || data.colorSlug === null || data.commanders.length === 0) {
          setPage({ status: 'none' });
          return;
        }
        const pool = data.commanders.slice(0, POOL);
        setPage({ status: 'ready', pool });
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, pool.length) }, async () => {
            while (!cancelled && next < pool.length) await ensureRef.current(pool[next++].name);
          })
        );
        if (!cancelled) setScored(true);
      } catch {
        if (!cancelled) setPage({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lean.slug, lean.color, attempt]);

  const ranked = useMemo(
    () =>
      page.status === 'ready'
        ? rankByCoverage(page.pool, (n) => readiness.get(n.toLowerCase()), SHOWN)
        : [],
    [page, readiness]
  );

  let body;
  if (page.status === 'loading') {
    body = (
      <p className="commander-finder-hint" role="status">
        Finding {name} commanders…
      </p>
    );
  } else if (page.status === 'error') {
    body = (
      <div className="commander-finder-empty-actions">
        <p className="commander-finder-hint" role="alert">
          Couldn't reach EDHREC for {name}.
        </p>
        <Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
      </div>
    );
  } else if (page.status === 'none') {
    body = (
      <p className="commander-finder-hint">
        EDHREC has no {LEAN_COLOR_WORD[lean.color]} page for {lean.label}.
      </p>
    );
  } else if (ranked.length === 0) {
    body = scored ? (
      <p className="commander-finder-hint">
        None of the top {lean.label} commanders in {LEAN_COLOR_WORD[lean.color]} share cards with
        your collection yet.
      </p>
    ) : (
      <p className="commander-finder-hint" role="status">
        Checking {page.pool.length} commanders against your cards…
      </p>
    );
  } else {
    body = (
      <ul className="commander-result-grid" aria-busy={!scored}>
        {ranked.map((c) => (
          <li key={c.name}>
            <CommanderResultCard
              name={c.name}
              colors={[lean.color]}
              comboName={colorComboName([lean.color])}
              readiness={readiness.get(c.name.toLowerCase())}
              coverageBar
              owned={isOwned(c.name)}
              numDecks={c.numDecks}
              selecting={selectingName === c.name}
              disabled={selectingName !== null}
              onSelect={() => onPick(c.name)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="commander-finder-lean" aria-labelledby={headingId}>
      <h4 className="commander-finder-buy-title" id={headingId}>
        {capital(name)}
      </h4>
      <p className="commander-finder-hint">
        {lean.matches} of your {lean.of} single-color {LEAN_COLOR_WORD[lean.color]} cards play{' '}
        {lean.label.toLowerCase()}.
      </p>
      {body}
    </section>
  );
}

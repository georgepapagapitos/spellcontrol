import './DeckIdeaPage.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '@/components/app-shell/BackLink';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { ColorIdentityPicker } from '@/components/shared/ColorIdentityPicker';
import { EmptyState } from '@/components/shared/EmptyState';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { Surface } from '@/components/shared/Surface';
import { backfillColorIdentities, fetchTagPageData } from '@/deck-builder/services/edhrec/client';
import type { DeckFormat, EDHRECTopCommander } from '@/deck-builder/types';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { colorComboName, colorWords } from '@/lib/deck/commander-finder';
import { parseDeckFormat } from '@/lib/deck/deck-format-param';
import { buildIdeaRouteState } from '@/lib/deck/idea-handoff';
import {
  findIdea,
  ideaBlurb,
  ideaKindLabel,
  ownedTypeCounts,
  shortCommanderName,
  useIdeaIndex,
  type Idea,
} from '@/lib/deck/idea-index';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { formatCount } from '@/lib/util/format-count';
import { useCollectionStore } from '@/store/collection';

/** Commanders listed before "Show more"; EDHREC's tag page carries at most 18. */
const FIRST_PAGE = 12;

type PageResult =
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ready'; commanders: EDHRECTopCommander[]; colorSlug: string | null };
/** A settled result stamped with the request it answers, so a stale one reads as loading. */
type Page = { status: 'loading' } | PageResult;

/**
 * `/decks/new/generate/idea/:slug` (E1112): the commanders that lead one deck idea, from EDHREC's
 * tag page, with a color filter and an owned filter. Building with one lands on the generator with
 * that commander and the matching EDHREC theme chosen.
 */
export function DeckIdeaPage() {
  const { slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const format: DeckFormat = parseDeckFormat(searchParams.get('format')) ?? 'commander';
  const state = useIdeaIndex();
  const generatorPath = `/decks/new/generate?format=${format}`;

  // Tag pages are commander-format data: other formats start at their own generator.
  if (format !== 'commander') return <Navigate to={generatorPath} replace />;

  const idea = state.status === 'ready' ? findIdea(state.index, slug) : undefined;
  return (
    <div className="deck-builder-page deck-idea-page">
      <BackLink to={generatorPath} label="Generate a deck" />
      {state.status === 'loading' && (
        <p className="deck-idea-status" role="status" aria-busy="true">
          <span className="spinner" aria-hidden="true" /> Loading deck ideas
        </p>
      )}
      {state.status === 'error' && (
        <EmptyState
          status
          tagline="Couldn't load the deck ideas."
          hint="Check your connection and try again."
          actions={<Button onClick={state.retry}>Retry</Button>}
        />
      )}
      {state.status === 'ready' && !idea && (
        <EmptyState
          status
          tagline="That deck idea isn't on the list."
          hint="The link may be old. Pick an idea from the generator."
          actions={
            <Button variant="primary" to={generatorPath}>
              Back to the generator
            </Button>
          }
        />
      )}
      {idea && <IdeaDetail idea={idea} format={format} generatorPath={generatorPath} />}
    </div>
  );
}

function IdeaDetail({
  idea,
  format,
  generatorPath,
}: {
  idea: Idea;
  format: DeckFormat;
  generatorPath: string;
}) {
  useDocumentTitle(`${idea.name} deck ideas`);
  const navigate = useNavigate();
  const collection = useCollectionStore((s) => s.cards);
  const [colors, setColors] = useState<ReadonlySet<string>>(new Set());
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [settled, setSettled] = useState<{ key: string; result: PageResult } | null>(null);
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState(FIRST_PAGE);
  const [building, setBuilding] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const colorKey = [...colors].sort().join('');
  const requestKey = `${idea.slug}|${colorKey}|${reload}`;
  const page: Page = settled?.key === requestKey ? settled.result : { status: 'loading' };
  useEffect(() => {
    let cancelled = false;
    const settle = (result: PageResult) => {
      if (!cancelled) setSettled({ key: requestKey, result });
    };
    void (async () => {
      try {
        const data = await fetchTagPageData(idea.slug, colorKey ? colorKey.split('') : []);
        if (cancelled) return;
        if (!data) {
          settle({ status: 'offline' });
          return;
        }
        // Tag pages carry no color identity; the pips need it.
        const commanders = await backfillColorIdentities(data.commanders);
        settle({ status: 'ready', commanders, colorSlug: data.colorSlug });
      } catch {
        settle({
          status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idea.slug, colorKey, requestKey]);

  // Every name on a tag page's commander list is a commander, so owning the card is owning it.
  const ownedCommanders = useMemo(
    () => new Set(collection.map((c) => c.name.toLowerCase())),
    [collection]
  );
  const isOwned = useCallback(
    (name: string) => ownedCommanders.has(name.toLowerCase()),
    [ownedCommanders]
  );
  const ownedOfType = useMemo(
    () => (idea.type ? (ownedTypeCounts(collection, [idea]).get(idea.slug) ?? 0) : 0),
    [collection, idea]
  );

  const all = page.status === 'ready' ? page.commanders : [];
  const ownedInPage = all.filter((c) => isOwned(c.name)).length;
  const list = ownedOnly ? all.filter((c) => isOwned(c.name)) : all;
  const visible = list.slice(0, shown);

  const build = async (name: string) => {
    setBuilding(name);
    setBuildError(null);
    try {
      const routeState = await buildIdeaRouteState(idea, name, format);
      navigate(generatorPath, { state: routeState });
    } catch {
      setBuildError(`Couldn't load ${name}. Try again.`);
      setBuilding(null);
    }
  };

  // The most built commander you own, else the most built of all.
  const pickForMe = () => {
    const pick = all.find((c) => isOwned(c.name)) ?? all[0];
    if (pick) void build(pick.name);
  };

  const ownLine =
    page.status === 'ready' && (ownedOfType > 0 || ownedInPage > 0)
      ? [
          ownedOfType > 0
            ? `You own ${formatCount(ownedOfType)} ${(ownedOfType === 1 ? (idea.type ?? idea.name) : idea.name).toLowerCase()}`
            : null,
          ownedInPage > 0
            ? `${ownedOfType > 0 ? 'and ' : 'You own '}${ownedInPage} of these commanders`
            : null,
        ]
          .filter(Boolean)
          .join(' ') + '.'
      : null;

  const colorFallback = page.status === 'ready' && colors.size > 0 && page.colorSlug === null;
  const colorName = colorComboName(colors) || colorWords(colors);

  return (
    <>
      <header className="deck-idea-hero">
        <Chip className="commander-result-fact" tone="neutral">
          {ideaKindLabel(idea.kind)}
        </Chip>
        <h1>{idea.name}</h1>
        <p className="deck-idea-blurb">{ideaBlurb(idea)}</p>
        {ownLine && <p className="deck-idea-own">{ownLine}</p>}
        <div className="deck-idea-pick">
          <Button
            variant="primary"
            onClick={pickForMe}
            disabled={page.status !== 'ready' || all.length === 0 || building !== null}
          >
            {building ? 'Opening…' : 'Pick a commander for me'}
          </Button>
          <span className="deck-idea-pick-hint">
            The most built commander you own, else the most built.
          </span>
        </div>
      </header>

      <section className="deck-builder-section" aria-labelledby="deck-idea-list-title">
        <h2 className="deck-builder-section-title" id="deck-idea-list-title">
          Commanders that lead {idea.name.toLowerCase()}
        </h2>
        <div className="deck-idea-filters">
          <div className="deck-idea-filter">
            <span className="deck-idea-filter-label" id="deck-idea-colors">
              Colors
            </span>
            <div role="group" aria-labelledby="deck-idea-colors">
              <ColorIdentityPicker
                colors={colors}
                onChange={(next) => {
                  setColors(next);
                  setShown(FIRST_PAGE);
                }}
              />
            </div>
          </div>
          <label className="deck-idea-owned">
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(e) => setOwnedOnly(e.target.checked)}
            />
            <span>I own the commander</span>
          </label>
        </div>
        {colorFallback && (
          <p className="deck-idea-note" role="status">
            EDHREC has no {colorName.toLowerCase()} list for {idea.name.toLowerCase()}. Showing
            every color.
          </p>
        )}

        {page.status === 'loading' && (
          <>
            <p className="sr-only" role="status">
              Loading commanders…
            </p>
            <ul className="deck-idea-list" aria-busy="true" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <li
                  key={i}
                  className="deck-idea-row deck-idea-row-skeleton"
                  data-surface="sleeve"
                />
              ))}
            </ul>
          </>
        )}
        {page.status === 'offline' && (
          <EmptyState
            status
            tagline="You're offline."
            hint="Commander lists come from EDHREC and need a connection."
            actions={<Button onClick={() => setReload((n) => n + 1)}>Retry</Button>}
          />
        )}
        {page.status === 'error' && (
          <EmptyState
            status
            tagline="Couldn't load the commanders."
            hint="EDHREC didn't answer. Try again in a moment."
            actions={<Button onClick={() => setReload((n) => n + 1)}>Retry</Button>}
          />
        )}
        {page.status === 'ready' && all.length === 0 && (
          <EmptyState
            status
            tagline={`No ${idea.name.toLowerCase()} commanders${colors.size > 0 ? ' in those colors' : ''}.`}
            hint={
              colors.size > 0
                ? 'Clear the colors to see every commander.'
                : 'EDHREC has none listed for this idea.'
            }
            actions={
              colors.size > 0 ? (
                <Button onClick={() => setColors(new Set())}>Clear colors</Button>
              ) : undefined
            }
          />
        )}
        {page.status === 'ready' && all.length > 0 && list.length === 0 && (
          <EmptyState
            status
            tagline="You don't own any of these commanders."
            hint="Turn off the filter to see every commander."
            actions={<Button onClick={() => setOwnedOnly(false)}>Show every commander</Button>}
          />
        )}
        {visible.length > 0 && (
          <ul className="deck-idea-list">
            {visible.map((c) => (
              <CommanderRow
                key={c.name}
                commander={c}
                owned={isOwned(c.name)}
                busy={building === c.name}
                disabled={building !== null}
                onBuild={() => void build(c.name)}
              />
            ))}
          </ul>
        )}
        {list.length > shown && (
          <p className="deck-idea-more">
            <Button variant="link" onClick={() => setShown(list.length)}>
              Show {list.length - shown} more
            </Button>
          </p>
        )}
        {buildError && (
          <p className="deck-idea-error" role="alert">
            {buildError}
          </p>
        )}
      </section>
    </>
  );
}

function CommanderRow({
  commander,
  owned,
  busy,
  disabled,
  onBuild,
}: {
  commander: EDHRECTopCommander;
  owned: boolean;
  busy: boolean;
  disabled: boolean;
  onBuild: () => void;
}) {
  const art = useCardThumb(commander.name, 'normal');
  const short = shortCommanderName(commander.name);
  return (
    <Surface variant="sleeve" as="li" className="deck-idea-row">
      <span className="commander-result-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="commander-result-art-skeleton" />
        )}
      </span>
      <span className="deck-idea-row-body">
        <span className="deck-idea-row-name">{commander.name}</span>
        <span className="deck-idea-row-meta">
          {commander.colorsUnknown ? (
            <span className="deck-idea-row-combo">Colors unavailable</span>
          ) : (
            commander.colorIdentity.length > 0 && (
              <>
                <span className="commander-result-pips" aria-hidden>
                  {commander.colorIdentity.map((c) => (
                    <ColorPip key={c} color={c} />
                  ))}
                </span>
                <span className="deck-idea-row-combo">
                  {colorComboName(commander.colorIdentity)}
                </span>
              </>
            )
          )}
        </span>
        <span className="deck-idea-row-facts">
          <Chip className="commander-result-fact" tone="neutral">
            {formatCount(commander.numDecks)} {commander.numDecks === 1 ? 'deck' : 'decks'}
          </Chip>
          {owned && (
            <Chip className="commander-result-fact" tone="success">
              Owned
            </Chip>
          )}
        </span>
      </span>
      <Button
        variant="primary"
        className="deck-idea-row-build"
        onClick={onBuild}
        disabled={disabled}
        aria-label={`Build with ${short}`}
      >
        {busy ? 'Opening…' : `Build with ${short}`}
      </Button>
    </Surface>
  );
}

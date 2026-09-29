import { ChevronDown, ExternalLink, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchCardPlayedIn,
  type CardPlayedIn,
  type CommanderPlay,
} from '@/deck-builder/services/edhrec/client';
import { Button } from '@/components/shared/Button';
import { MeterBar } from '@/components/shared/MeterBar';
import { OwnershipBadge } from '@/components/deck/OwnershipBadge';
import { useCardCarousel, type CarouselEntry } from '@/components/deck/useCardCarousel';
import { useCardThumb } from '@/lib/card-thumbs';
import { frontFaceName } from '@/lib/card-text';
import { formatCount } from '@/lib/format-count';
import { classifyInclusion, inclusionColor } from '@/lib/inclusion-label';
import { useCollectionStore } from '@/store/collection';
import './PlayedInSection.css';

/** How long the section waits for the card to settle before fetching: the
 *  preview mounts it per focused card, so swiping past twenty cards must not
 *  fire twenty requests. Same wait as Rulings. */
export const PLAYED_IN_SETTLE_MS = 350;

/** Top commanders shown before "Show all". */
const TOP_SHOWN = 5;

type State = { status: 'loading' } | CardPlayedIn;

/** "In 36% of its 55k decks", or Off-meta under 1%. */
function Inclusion({ play }: { play: CommanderPlay }) {
  const info = classifyInclusion(play.pct);
  const decks = formatCount(play.potentialDecks);
  if (info.kind === 'offmeta') {
    return (
      <span className="played-in-incl is-offmeta" title={`Under 1% of its ${decks} decks`}>
        Off-meta
      </span>
    );
  }
  const color = inclusionColor(info.pct);
  return (
    <span className="played-in-incl">
      <span className="played-in-incl-text">
        In{' '}
        <span className="played-in-incl-pct" style={{ color }}>
          {info.pct}%
        </span>{' '}
        of its {decks} decks
      </span>
      <MeterBar className="played-in-meter" value={info.pct} max={100} color={color} />
    </span>
  );
}

function inclusionLabel(play: CommanderPlay): string {
  const info = classifyInclusion(play.pct);
  const decks = formatCount(play.potentialDecks);
  return info.kind === 'pct' ? `In ${info.pct}% of its ${decks} decks` : info.label;
}

function PlayRow({
  play,
  owned,
  onOpen,
}: {
  play: CommanderPlay;
  owned: boolean;
  onOpen: () => void;
}) {
  const art = useCardThumb(play.name, 'art_crop');
  return (
    <li>
      <button
        type="button"
        className="played-in-row"
        onClick={onOpen}
        aria-label={`${play.name}. ${inclusionLabel(play)}${owned ? '. Owned' : ''}`}
      >
        <span className="played-in-art" aria-hidden>
          {art && <img src={art} alt="" loading="lazy" draggable={false} />}
        </span>
        <span className="played-in-body" aria-hidden>
          <span className="played-in-title">
            <span className="played-in-name">{play.name}</span>
            {owned && <OwnershipBadge owned />}
          </span>
          <Inclusion play={play} />
        </span>
      </button>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="played-in-list" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="played-in-row is-skeleton">
          <span className="played-in-art">
            <span className="card-preview-image-skeleton" />
          </span>
          <span className="played-in-body">
            <span className="played-in-skel-line">
              <span className="card-preview-image-skeleton" />
            </span>
            <span className="played-in-skel-line is-short">
              <span className="card-preview-image-skeleton" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The card preview's "Played in" section: the commanders EDHREC sees this card
 * played under, with how many of each one's decks run it and whether the
 * viewer owns the commander. Tapping a commander opens it in a preview of its
 * own, with a way to build a deck around it.
 *
 * Loaded lazily by CardPreview. Render with `key={name}` so it resets per card.
 * Renders nothing when EDHREC has no page for the card (tokens, brand-new
 * printings, offline).
 */
export function PlayedInSection({
  name,
  onLeave,
}: {
  name: string;
  /** Closes the preview this section sits in, before navigating away. */
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });
  // Bumped by Retry to run the fetch again.
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(
      () => {
        void fetchCardPlayedIn(name).then((r) => {
          if (alive) setState(r);
        });
      },
      attempt === 0 ? PLAYED_IN_SETTLE_MS : 0
    );
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [name, attempt]);

  const collection = useCollectionStore((s) => s.cards);
  const ownedNames = useMemo(
    () => new Set(collection.map((c) => frontFaceName(c.name).toLowerCase())),
    [collection]
  );
  const isOwned = (play: CommanderPlay) => ownedNames.has(frontFaceName(play.name).toLowerCase());

  // The nested preview's context line names this card, so a commander's line
  // reads "Smothering Tithe · In 36% of its 55k decks".
  const carousel = useCardCarousel(name, (entry: CarouselEntry) => [
    {
      key: 'build',
      label: 'Build a deck',
      shortLabel: 'Build',
      icon: <Wand2 width={18} height={18} strokeWidth={2} aria-hidden />,
      closesPreview: true,
      onClick: () => {
        onLeave();
        navigate(`/decks/new/generate?commander=${encodeURIComponent(entry.name)}`);
      },
    },
  ]);

  // No page (or offline), or a page with nothing to say: the section isn't there.
  if (state.status === 'none') return null;
  if (state.status === 'ok' && !state.card && state.top.length === 0 && state.new.length === 0) {
    return null;
  }

  const openGroup = (group: CommanderPlay[], tapped: string) =>
    carousel.open(
      group.map((p) => ({ name: p.name, label: inclusionLabel(p) })),
      tapped
    );

  const renderGroup = (label: string, group: CommanderPlay[], limit?: number) => {
    if (group.length === 0) return null;
    const shown = limit ? group.slice(0, limit) : group;
    return (
      <div className="played-in-group">
        <h4 className="played-in-group-label">{label}</h4>
        <ul className="played-in-list">
          {shown.map((p) => (
            <PlayRow
              key={p.name}
              play={p}
              owned={isOwned(p)}
              onOpen={() => openGroup(group, p.name)}
            />
          ))}
        </ul>
      </div>
    );
  };

  // A popover-like layer inside the preview must not wake the preview: the
  // nested preview is portaled to <body>, but its React events still bubble
  // through this tree into the host sheet's drag and close-on-empty handlers.
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <section className="card-preview-sec card-preview-sec--disc played-in">
      <button
        type="button"
        className="card-disc-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          width={14}
          height={14}
          strokeWidth={1.8}
          aria-hidden
          className={`card-disc-chevron${open ? ' is-open' : ''}`}
        />
        Played in
      </button>

      {open && (
        <div className="played-in-content">
          {state.status === 'loading' && (
            <>
              <p className="sr-only" role="status">
                Loading commanders…
              </p>
              <SkeletonRows />
            </>
          )}
          {state.status === 'error' && (
            <p className="played-in-status">
              Couldn't load commanders from EDHREC.{' '}
              <Button
                variant="link"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((a) => a + 1);
                }}
              >
                Retry
              </Button>
            </p>
          )}
          {state.status === 'ok' && (
            <>
              {state.card && <Headline card={state.card} />}
              {renderGroup('Top commanders', state.top, showAll ? undefined : TOP_SHOWN)}
              {state.top.length > TOP_SHOWN && (
                <Button
                  variant="link"
                  className="played-in-more"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((s) => !s)}
                >
                  {showAll ? 'Show fewer' : `Show all ${state.top.length}`}
                </Button>
              )}
              {renderGroup('New commanders', state.new)}
              <a
                href={`https://edhrec.com/cards/${state.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="card-preview-ext-link played-in-source"
              >
                View on EDHREC
                <ExternalLink
                  width={12}
                  height={12}
                  strokeWidth={2}
                  aria-hidden
                  className="card-preview-ext-link-icon"
                />
              </a>
            </>
          )}
        </div>
      )}

      {carousel.preview && (
        <div
          role="presentation"
          onClick={stop}
          onPointerDown={stop}
          onTouchStart={stop}
          onTouchMove={stop}
          onTouchEnd={stop}
        >
          {carousel.preview}
        </div>
      )}
    </section>
  );
}

/** The card across every deck that could run it. */
function Headline({ card }: { card: { numDecks: number; potentialDecks: number; pct: number } }) {
  const info = classifyInclusion(card.pct);
  const sample = `${card.numDecks.toLocaleString()} of ${card.potentialDecks.toLocaleString()} decks on EDHREC`;
  if (info.kind === 'offmeta') {
    return (
      <p className="played-in-headline is-offmeta" title={sample}>
        Under 1% of decks that can play it
      </p>
    );
  }
  return (
    <p className="played-in-headline" title={sample}>
      In{' '}
      <span className="played-in-incl-pct" style={{ color: inclusionColor(info.pct) }}>
        {info.pct}%
      </span>{' '}
      of decks that can play it
    </p>
  );
}

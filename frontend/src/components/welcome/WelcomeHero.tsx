import './WelcomeHero.css';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FlaskConical, Import, Swords } from 'lucide-react';
import { SearchPill } from '../SearchPill';
import { useCardThumb } from '../../lib/card-thumbs';
import { markEverVisited } from '../../lib/first-run';
import { track } from '../../lib/analytics';
import { pickWelcomeHeroCard } from '../../lib/welcome-hero';
import { Button, IconButton } from '@/components/shared/Button';

interface WelcomeHeroProps {
  /** Door 4 — Try sample cards (E343, moved up from the tightened row below
   *  the live rails, which measured at ~73% of the page). Owned by
   *  WelcomePage (useLoadSamples) since it needs that page's own async load
   *  state; the hero only renders the button and defers to these props. */
  onTrySamples: () => void;
  samplesLoading: boolean;
}

/**
 * WelcomePage's hero band (welcome storefront, pass 2c — Moxfield-hero-
 * informed, our own identity). Guests have no collection to draw art from
 * (unlike HomeHero's collection-backed pick), so the backdrop rotates a
 * small hardcoded pool of iconic Commander staples by day key
 * (`pickWelcomeHeroCard`) instead. Same theme-invariant `--art-scrim`
 * treatment as HomeHero/DiscoverDeckTile — card art is unpredictable in both
 * themes, so on-art text can't follow the light/dark swap.
 *
 * A native `<header>` (this page's one header landmark — WelcomePage itself
 * renders outside <Layout>, so there's no site header to collide with).
 * Every action here is self-contained (search submit, the Import CTA's
 * markEverVisited) except the samples door, which the page owns.
 */
export function WelcomeHero({ onTrySamples, samplesLoading }: WelcomeHeroProps) {
  const navigate = useNavigate();
  const heroCardName = pickWelcomeHeroCard();
  // art_crop, never 'normal' — same ruling as HomeHero: the frameless
  // illustration, not a card scan's border cover-cropped to a dark strip.
  // It is also the landing's largest contentful paint, so the <img> below is
  // eager + high fetch priority: lazy-loading it told the browser to wait.
  const art = useCardThumb(heroCardName, 'art_crop');
  const [query, setQuery] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    navigate(term ? `/decks/discover?q=${encodeURIComponent(term)}` : '/decks/discover');
  }

  return (
    <header className="welcome-hero">
      <div className="welcome-hero-backdrop" aria-hidden="true">
        {art ? (
          <img
            className="welcome-hero-art"
            src={art}
            alt=""
            aria-hidden="true"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <span className="welcome-hero-art-loading" />
        )}
        <span className="welcome-hero-scrim" />
      </div>

      <div className="welcome-hero-content">
        <div className="welcome-hero-brand">
          <span className="welcome-hero-wordmark">SpellControl</span>
        </div>

        <h1 className="welcome-hero-headline">Plan your Magic collection.</h1>
        <p className="welcome-hero-tagline">
          Import what you own, build decks around it, and track every game. No account required.
        </p>

        <form className="welcome-hero-search" role="search" onSubmit={handleSubmit}>
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder="Search decks, commanders, builders"
            ariaLabel="Search public decks"
            className="welcome-hero-search-pill"
            trailing={
              <IconButton
                className="welcome-hero-search-submit"
                type="submit"
                label="Search"
                icon={<ArrowRight width={16} height={16} strokeWidth={2} />}
              />
            }
          />
        </form>

        <div className="welcome-hero-ctas">
          <Button
            variant="primary"
            placement="row"
            to="/collection?add=list"
            onClick={() => {
              markEverVisited();
              track('import_started');
            }}
            icon={<Import width={14} height={14} strokeWidth={1.8} />}
          >
            Import your collection
          </Button>
          {/* The life-counter door. A local game needs no account and no
              collection, so this goes straight to a running table rather than
              a setup form (PlayPage reads `new=1`) — someone who arrived for a
              life counter should not have to pretend to care about a
              collection first. markEverVisited for the same reason the Import
              door calls it: starting a game is an intentional first action, so
              the first-run gate must not bounce them back here next boot and
              hide the game they left running. No track() call — `play_started`
              fires from the store when the game actually starts, which is the
              honest event. */}
          <Button
            placement="row"
            to="/play?new=1"
            onClick={markEverVisited}
            className="welcome-hero-cta-secondary"
            icon={<Swords width={14} height={14} strokeWidth={1.8} />}
          >
            Start a game
          </Button>
          <Button
            placement="row"
            to="/decks/discover"
            onClick={() => track('browse_decks')}
            className="welcome-hero-cta-secondary"
          >
            Browse public decks
          </Button>
          {/* Door 4 — the zero-commitment way in: no account, nothing of
              your own required, just cards to look at. Same sample-load
              path as before (importText -> loadSampleBinders, tagged
              isSample); only the placement changed (E343). */}
          <Button
            placement="row"
            onClick={onTrySamples}
            disabled={samplesLoading}
            className="welcome-hero-cta-secondary"
            icon={<FlaskConical width={14} height={14} strokeWidth={1.8} />}
          >
            {samplesLoading ? 'Loading samples…' : 'Try sample cards'}
          </Button>
        </div>
      </div>

      {art && <p className="welcome-hero-caption">{heroCardName} · art via Scryfall</p>}
    </header>
  );
}

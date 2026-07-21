import './WelcomeHero.css';
import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Import } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { SearchPill } from '../SearchPill';
import { useCardThumb } from '../../lib/card-thumbs';
import { markEverVisited } from '../../lib/first-run';
import { pickWelcomeHeroCard } from '../../lib/welcome-hero';

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
 * Zero props: every action here (search submit, the Import CTA's
 * markEverVisited) is self-contained, mirroring HomeHero's own signature.
 */
export function WelcomeHero() {
  const navigate = useNavigate();
  const heroCardName = pickWelcomeHeroCard();
  const art = useCardThumb(heroCardName, 'normal');
  const [query, setQuery] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    navigate(term ? `/decks/discover?commander=${encodeURIComponent(term)}` : '/decks/discover');
  }

  return (
    <header className="welcome-hero">
      <div className="welcome-hero-backdrop" aria-hidden="true">
        {art ? (
          <img className="welcome-hero-art" src={art} alt="" aria-hidden="true" loading="lazy" />
        ) : (
          <span className="welcome-hero-art-loading" />
        )}
        <span className="welcome-hero-scrim" />
      </div>

      <div className="welcome-hero-content">
        <div className="welcome-hero-brand">
          <BrandMark size={40} motion="idle" aria-hidden />
          <span className="welcome-hero-wordmark">SpellControl</span>
        </div>

        <h1 className="welcome-hero-headline">Plan your Magic collection.</h1>
        <p className="welcome-hero-tagline">
          Import what you own, build decks around it, and track every game — no account required.
        </p>

        <form className="welcome-hero-search" role="search" onSubmit={handleSubmit}>
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder="Search commanders on Discover"
            ariaLabel="Search public decks by commander"
            className="welcome-hero-search-pill"
            trailing={
              <button type="submit" className="welcome-hero-search-submit" aria-label="Search">
                <ArrowRight width={16} height={16} strokeWidth={2} aria-hidden />
              </button>
            }
          />
        </form>

        <div className="welcome-hero-ctas">
          <Link
            to="/collection?add=list"
            className="pill-btn pill-btn-primary"
            onClick={() => markEverVisited()}
          >
            <Import width={14} height={14} strokeWidth={1.8} aria-hidden />
            Import your collection
          </Link>
          <Link to="/decks/discover" className="pill-btn welcome-hero-cta-secondary">
            Browse public decks
          </Link>
        </div>
      </div>

      {art && <p className="welcome-hero-caption">{heroCardName} — art via Scryfall</p>}
    </header>
  );
}

/**
 * WelcomePage — the public landing page (served at `/` for first-time/
 * logged-out visitors) and first-run onboarding screen in one: the welcome
 * storefront (pass 2c) — an art-led hero (WelcomeHero) with live public-deck
 * rails below it, then the page's original onboarding/feature/legal content
 * in tightened form.
 *
 * Doubles as the site's SEO landing surface: a fresh visitor (empty
 * localStorage, guest auth) and search-engine crawlers both reach this via
 * App's `/` route, so it carries the real "what is SpellControl" content —
 * hero, feature prose, supported imports — that the rest of the app (gated /
 * client-rendered) can't expose to crawlers. Returning guests and authed
 * users skip it (App routes them straight to /collection).
 *
 * Onboarding doors, now split between the hero and a tightened row below the
 * live rails:
 *   1. Import my collection → /collection?add=list (AddCardsSheet) — the
 *      hero's own primary CTA; WelcomeHero owns this door's handler.
 *   2. Browse public decks  → /decks/discover — the hero's secondary CTA.
 *   3. Try sample cards     → loads the sample pack via loadSampleBinders,
 *      then navigates to /collection — stays here (below the rails) since it
 *      needs this page's own async load state.
 *   4. Sign in              → /auth (the existing AuthPage, unchanged) —
 *      alongside door 3.
 *
 * Doors 1 and 3 dismiss the first-run gate permanently via markEverVisited();
 * door 4 defers to AuthPage's own completion handlers, so abandoning /auth
 * without finishing still reshows the welcome next boot.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FlaskConical, LogIn, Layers, Wand2, SlidersHorizontal, Swords } from 'lucide-react';
import { useCollectionStore } from '../store/collection';
import { importText } from '../lib/api';
import { sampleCardsAsCsv } from '../lib/samples';
import { markEverVisited } from '../lib/first-run';
import { WelcomeHero } from '../components/welcome/WelcomeHero';
import { FreshDecksRail } from '../components/welcome/FreshDecksRail';
import { TrendingRail } from '../components/aggregates/TrendingRail';
import './WelcomePage.css';

/** Feature blocks — real prose so the page has something for search engines to
 *  index (the gated app itself exposes almost no crawlable text). Claims here
 *  must stay accurate to README's feature list. */
const FEATURES = [
  {
    Icon: Layers,
    title: 'Rule-based binders',
    body: 'Sort your physical collection into binders defined by rules — colors, types, sets, price, tags. Set the pocket size and order; every card files itself into the first binder it matches.',
  },
  {
    Icon: Wand2,
    title: 'Generate Commander decks',
    body: 'Pick a commander, choose themes, and set a power bracket — then get a full 100-card deck from EDHREC data, balanced for mana curve and card roles.',
  },
  {
    Icon: SlidersHorizontal,
    title: 'Tune any deck with the Coach',
    body: 'Build in eight formats with live legality checks — then tune with the Coach: a ranked list of moves (add, cut, swap for a card you already own), each with a plain-English reason. Backed by combo, win-condition, and synergy analysis, plus power-bracket fit.',
  },
  {
    Icon: Swords,
    title: 'Track multiplayer games',
    body: 'Run life totals and full game state across your pod — local games at the table or live online sessions synced across devices.',
  },
];

export function WelcomePage() {
  const navigate = useNavigate();
  const loadSampleBinders = useCollectionStore((s) => s.loadSampleBinders);
  const setError = useCollectionStore((s) => s.setError);

  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  /**
   * Door 3 — Try sample cards.
   * Reuses the exact same load path as BindersIndexPage: importText (CSV) →
   * loadSampleBinders (importCards + sample binder defs). Tagged with
   * isSample = true via the store so the import shows as a normal, deletable
   * entry in import history.
   */
  async function handleSamples() {
    setLoadingSamples(true);
    setSampleError(null);
    try {
      const response = await importText(sampleCardsAsCsv());
      await loadSampleBinders(response);
      markEverVisited();
      navigate('/collection');
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load sample cards";
      setSampleError(msg);
      // Propagate to the global error banner too (matches BindersIndexPage behaviour)
      setError(msg);
    } finally {
      setLoadingSamples(false);
    }
  }

  return (
    <div className="welcome-page">
      <div className="welcome-shell">
        <WelcomeHero />

        <FreshDecksRail />

        {/* "Trending commanders" — TrendingRail mounted as-is (it already
            renders its own title + loading/error/empty states; verified
            guest-safe and already reachable logged-out on /decks/discover).
            Only the trailing "View all" link is new here — TrendingRail has
            no such link of its own since every one of ITS OWN tiles already
            links to a real destination (a deck or the deck builder), never
            back to /decks/discover itself. */}
        <section className="welcome-trending" aria-label="Trending commanders">
          <TrendingRail enabled={true} />
          <Link to="/decks/discover" className="home-card-view-all">
            View all public decks →
          </Link>
        </section>

        <section className="welcome-alt-start" aria-label="Other ways to start">
          <div className="welcome-doors">
            {/* Door 3 — primary: samples */}
            <button
              type="button"
              className="pill-btn"
              onClick={() => void handleSamples()}
              disabled={loadingSamples}
            >
              <FlaskConical width={16} height={16} aria-hidden />
              {loadingSamples ? 'Loading samples…' : 'Try sample cards'}
            </button>

            {/* Door 4 — secondary: sign in. markEverVisited is NOT called
                here — AuthPage / auth store actions call it when the user
                completes any auth choice (login / register / continue as
                guest), which is the correct dismissal point. A plain <Link>
                (not an onClick+navigate button) so cmd/ctrl/middle-click
                still work, same reasoning as TrendingRail's own tiles. */}
            <Link to="/auth" className="pill-btn welcome-door-secondary">
              <LogIn width={16} height={16} aria-hidden />
              Sign in
            </Link>
          </div>

          {sampleError && <p className="welcome-error">{sampleError}</p>}
        </section>

        <section className="welcome-features" aria-label="What SpellControl does">
          {FEATURES.map(({ Icon, title, body }) => (
            <article key={title} className="welcome-feature">
              <span className="welcome-feature-icon" aria-hidden>
                <Icon width={20} height={20} />
              </span>
              <h2 className="welcome-feature-title">{title}</h2>
              <p className="welcome-feature-body">{body}</p>
            </article>
          ))}
        </section>

        <footer className="welcome-footer">
          <nav className="welcome-footer-links" aria-label="Site links">
            <a href="/guides/">Import guides</a>
            <a href="/privacy.html">Privacy</a>
          </nav>
          <p className="welcome-disclaimer">
            SpellControl is unofficial Fan Content permitted under the Wizards of the Coast Fan
            Content Policy. Not approved or endorsed by Wizards. Magic: The Gathering and its logos
            are trademarks of Wizards of the Coast LLC. Card data and images via Scryfall.
          </p>
        </footer>
      </div>
    </div>
  );
}

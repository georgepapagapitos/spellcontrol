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
 * The first-run gate (lib/first-run.ts / use-first-run-gate.ts) sends a
 * fresh guest here — to the welcome storefront at `/`, not `/auth` — leaving
 * sign-in as one of this page's own doors (below) rather than a forced stop.
 *
 * Onboarding doors, now split between the hero and a tightened row below the
 * live rails:
 *   1. Import my collection → /collection?add=list (AddCardsSheet) — the
 *      hero's own primary CTA; WelcomeHero owns this door's handler.
 *   2. Start a game        → /play?new=1 — the hero's second CTA. Local play
 *      needs no account and no collection, and PlayPage reads `new=1` to open
 *      on a running table rather than a setup form, so this is genuinely one
 *      tap from the landing to a life counter.
 *   3. Browse public decks  → /decks/discover — the hero's last CTA.
 *   4. Try sample cards     → loads the sample pack via loadSampleBinders,
 *      then navigates to /collection — stays here (below the rails) since it
 *      needs this page's own async load state.
 *   5. Sign in              → /auth (the existing AuthPage, unchanged) —
 *      alongside door 4.
 *
 * Doors 1, 2 and 4 dismiss the first-run gate permanently via
 * markEverVisited() — each is an intentional first action, and door 2 in
 * particular must not bounce the visitor back here next boot and hide the game
 * they left running. Door 5 defers to AuthPage's own completion handlers, so
 * abandoning /auth without finishing still reshows the welcome next boot.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FlaskConical, LogIn, Layers, Wand2, SlidersHorizontal, Swords } from 'lucide-react';
import { useLoadSamples } from '../lib/use-load-samples';
import { markEverVisited } from '../lib/first-run';
import { track } from '../lib/analytics';
import { WelcomeHero } from '../components/welcome/WelcomeHero';
import { FreshDecksRail } from '../components/welcome/FreshDecksRail';
import { TrendingRail } from '../components/aggregates/TrendingRail';
import './WelcomePage.css';
import { Button } from '@/components/shared/Button';

/** Feature blocks — real prose so the page has something for search engines to
 *  index (the gated app itself exposes almost no crawlable text). Claims here
 *  must stay accurate to README's feature list. */
const FEATURES = [
  {
    Icon: Layers,
    title: 'Rule-based binders',
    body: 'Sort your physical collection into binders. Cards file into the first one whose rule matches, top to bottom.',
  },
  {
    Icon: Wand2,
    title: 'Generate Commander decks',
    body: 'Pick a commander and a power bracket, and generate a full 100-card deck tuned to your curve and role mix.',
  },
  {
    Icon: SlidersHorizontal,
    title: 'Tune any deck with the Coach',
    body: 'Build in eight formats with live legality checks, then tune with the Coach: a ranked list of adds, cuts, and swaps, each with a plain-English reason.',
  },
  {
    Icon: Swords,
    title: 'Track multiplayer games',
    body: 'Run life totals and full game state for your pod, at the table or online, synced across devices.',
  },
];

export function WelcomePage() {
  const navigate = useNavigate();
  const { load: loadSamples, loading: loadingSamples, error: sampleError } = useLoadSamples();
  // TrendingRail hides itself when nothing qualifies, but it still fetches
  // and can flash a skeleton. Gate it on whether the sibling rail found
  // enough live data: if there isn't enough for one rail, there's unlikely
  // to be enough for the other. (B1-06)
  const [hasFreshDecks, setHasFreshDecks] = useState(false);

  /**
   * Door 3 — Try sample cards.
   * `useLoadSamples` owns the load path (importText → loadSampleBinders,
   * shared with Home's get-started card); this page only wires the
   * post-success navigation and first-run dismissal.
   */
  async function handleSamples() {
    const ok = await loadSamples();
    if (!ok) return;
    markEverVisited();
    track('sample_loaded');
    navigate('/collection');
  }

  return (
    <div className="welcome-page">
      <main className="welcome-shell">
        <WelcomeHero />

        <FreshDecksRail onVisibilityChange={setHasFreshDecks} />

        {/* Mounted only once the sibling rail above found enough live data
            (see hasFreshDecks). The rail is its own labelled section; the
            way on to /decks/discover is FreshDecksRail's "View all". */}
        {hasFreshDecks && <TrendingRail enabled={true} />}

        <section className="welcome-alt-start" aria-label="Other ways to start">
          <div className="welcome-doors">
            {/* Door 3 — primary: samples */}
            <Button
              placement="row"
              onClick={() => void handleSamples()}
              disabled={loadingSamples}
              icon={<FlaskConical width={16} height={16} />}
            >
              {loadingSamples ? 'Loading samples…' : 'Try sample cards'}
            </Button>

            {/* Door 4 — secondary: sign in. markEverVisited is NOT called
                here — AuthPage / auth store actions call it when the user
                completes any auth choice (login / register / continue as
                guest), which is the correct dismissal point. A plain <Link>
                (not an onClick+navigate button) so cmd/ctrl/middle-click
                still work, same reasoning as TrendingRail's own tiles. */}
            <Button
              placement="row"
              to="/auth"
              onClick={() => track('sign_in')}
              className="welcome-door-secondary"
              icon={<LogIn width={16} height={16} />}
            >
              Sign in
            </Button>
          </div>

          {sampleError && <p className="welcome-error">{sampleError}</p>}

          {/* Door 5 — the way past. Every other door here asks for something:
              an import, an account, a pile of cards you don't own. Without
              this one the gate has no exit that isn't a commitment, and
              `useFirstRunGate` sends a first-run guest back here from any
              non-exempt path, so someone who typed /rules could not reach it.
              Deliberately quiet: it is the answer to "I just want to look",
              not a peer of the two real doors.

              markEverVisited() because this IS an intentional first choice,
              and /collection because that is where App already routes a
              returning guest from `/`. A <Link> (not navigate) so
              cmd/ctrl/middle-click still work, same as Sign in above. */}
          <Link
            to="/collection"
            className="welcome-skip"
            onClick={() => {
              markEverVisited();
              track('skipped_welcome');
            }}
          >
            Look around first
          </Link>
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
            <a href="/guides/organize-your-binder.html">Organize a binder</a>
            <a href="/guides/">Import guides</a>
            <a href="/guides/compare.html">Compare</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
          </nav>
          <p className="welcome-disclaimer">
            SpellControl is unofficial Fan Content permitted under the Wizards of the Coast Fan
            Content Policy. Not approved or endorsed by Wizards. Magic: The Gathering and its logos
            are trademarks of Wizards of the Coast LLC. Card data and images via Scryfall.
          </p>
        </footer>
      </main>
    </div>
  );
}

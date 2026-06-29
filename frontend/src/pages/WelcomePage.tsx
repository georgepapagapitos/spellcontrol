/**
 * WelcomePage — public landing page (served at `/` for first-time/logged-out
 * visitors) and first-run onboarding screen in one.
 *
 * Doubles as the site's SEO landing surface: a fresh visitor (empty
 * localStorage, guest auth) and search-engine crawlers both reach this via
 * App's `/` route, so it carries the real "what is SpellControl" content —
 * hero, feature prose, supported imports — that the rest of the app (gated /
 * client-rendered) can't expose to crawlers. Returning guests and authed
 * users skip it (App routes them straight to /collection).
 *
 * The hero keeps the three original onboarding doors as its calls to action:
 *   1. Import my collection  → /collection?add=list  (opens AddCardsSheet)
 *   2. Try sample cards      → loads the sample pack via loadSampleBinders,
 *                              then navigates to /collection
 *   3. Sign in               → /auth (the existing AuthPage, unchanged)
 *
 * Any door dismisses the first-run gate permanently via markEverVisited().
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Import,
  FlaskConical,
  LogIn,
  Layers,
  Wand2,
  SlidersHorizontal,
  Swords,
} from 'lucide-react';
import { useCollectionStore } from '../store/collection';
import { importText } from '../lib/api';
import { sampleCardsAsCsv } from '../lib/samples';
import { markEverVisited } from '../lib/first-run';
import { BrandMark } from '../components/shared/BrandMark';
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
   * Door 1 — Import my collection.
   * Deep-links to /collection?add=list which CollectionPage already handles
   * (AddCardsSheet opens on the list tab, per #571).
   */
  function handleImport() {
    markEverVisited();
    navigate('/collection?add=list');
  }

  /**
   * Door 2 — Try sample cards.
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
      const msg = err instanceof Error ? err.message : 'Could not load sample cards';
      setSampleError(msg);
      // Propagate to the global error banner too (matches BindersIndexPage behaviour)
      setError(msg);
    } finally {
      setLoadingSamples(false);
    }
  }

  /**
   * Door 3 — Sign in.
   * Just navigates to /auth (AuthPage is unchanged).
   * markEverVisited is NOT called here — AuthPage / auth store actions call it
   * when the user completes any auth choice (login / register / continue as
   * guest), which is the correct dismissal point. We only navigate; we don't
   * pre-dismiss so that if the user abandons /auth without making a choice, the
   * welcome can still show on next boot.
   */
  function handleSignIn() {
    navigate('/auth');
  }

  return (
    <div className="welcome-page">
      <main className="welcome-card">
        <header className="welcome-hero">
          <div className="welcome-brand-mark" aria-hidden="true">
            <BrandMark size={56} />
          </div>
          <p className="welcome-brand">SpellControl</p>
          <h1 className="welcome-headline">Plan your Magic: The Gathering collection</h1>
          <p className="welcome-tagline">
            Import your collection, organize it into binders, build and tune decks, and track your
            games — all on your devices, no account required.
          </p>

          <div className="welcome-doors">
            {/* Door 1 — primary: import */}
            <button type="button" className="pill-btn pill-btn-primary" onClick={handleImport}>
              <Import width={16} height={16} aria-hidden />
              Import my collection
            </button>

            {/* Door 2 — primary: samples */}
            <button
              type="button"
              className="pill-btn pill-btn-primary"
              onClick={() => void handleSamples()}
              disabled={loadingSamples}
            >
              <FlaskConical width={16} height={16} aria-hidden />
              {loadingSamples ? 'Loading samples…' : 'Try sample cards'}
            </button>

            {/* Door 3 — secondary: sign in */}
            <button
              type="button"
              className="pill-btn welcome-door-secondary"
              onClick={handleSignIn}
            >
              <LogIn width={16} height={16} aria-hidden />
              Sign in
            </button>
          </div>

          {sampleError && <p className="welcome-error">{sampleError}</p>}
        </header>

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
          <a href="/privacy.html">Privacy</a>
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

/**
 * WelcomePage — UX-331 first-run welcome screen.
 *
 * Shown exactly once on a brand-new install (no cards, no auth, gate not yet
 * dismissed). Three doors:
 *   1. Import my collection  → /collection?add=list  (opens AddCardsSheet)
 *   2. Try sample cards      → loads the existing sample pack via the store's
 *                              loadSampleBinders action, then navigates to
 *                              /collection
 *   3. Sign in               → /auth (the existing AuthPage, unchanged)
 *
 * Any door dismisses the gate permanently via markEverVisited().
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Import, FlaskConical, LogIn } from 'lucide-react';
import { useCollectionStore } from '../store/collection';
import { importText } from '../lib/api';
import { sampleCardsAsCsv } from '../lib/samples';
import { markEverVisited } from '../lib/first-run';
import './WelcomePage.css';

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
   *
   * Exception: we DO navigate, so the gate must treat /auth as exempt (already
   * true — isFirstRunExempt('/auth') === true). The welcome itself is also
   * exempt via isFirstRunExempt so there's no redirect loop.
   */
  function handleSignIn() {
    navigate('/auth');
  }

  return (
    <div className="welcome-page">
      <div className="welcome-card">
        <h1 className="welcome-brand">SpellControl</h1>
        <p className="welcome-tagline">Your Magic collection, organised for your binder.</p>

        <div className="welcome-doors">
          {/* Door 1 — primary: import */}
          <button
            type="button"
            className="pill-btn pill-btn-primary"
            onClick={handleImport}
            disabled={loadingSamples}
          >
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
            disabled={loadingSamples}
          >
            <LogIn width={16} height={16} aria-hidden />
            Sign in
          </button>
        </div>

        {sampleError && <p className="welcome-error">{sampleError}</p>}
      </div>
    </div>
  );
}

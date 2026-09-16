import './GetStartedCard.css';
import { Check, Compass } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useLoadSamples } from '../../lib/use-load-samples';
import { track } from '../../lib/analytics';
import { HomeCard } from './HomeCard';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';

interface Step {
  label: string;
  href: string;
  done: boolean;
}

/**
 * Home's first-run checklist — the only door out of the Welcome page's
 * onboarding doors that survives into the authed app. Renders only while
 * the account has none of the three real milestones yet, and disappears for
 * good once every step is done (no dismissal state to track). Placed first
 * in the bento (HomePage.tsx) so it's the first thing a new account sees.
 */
export function GetStartedCard() {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const deckCount = useDecksStore((s) => s.decks.length);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const awaitingFirstPull = useAwaitingFirstPull();
  const navigate = useNavigate();
  const { load: loadSamples, loading: loadingSamples, error: sampleError } = useLoadSamples();

  // ponytail: hides outright while either store is still hydrating rather
  // than showing a skeleton — this is the bento's first tile, so it
  // appearing then vanishing would reflow every card below it once a
  // returning, fully-set-up account's real counts land. A brand new
  // account's hydration is a fast local IndexedDB read, so the brief
  // absence there isn't noticeable. Upgrade to a remembered-shape skeleton
  // (lib/home-shape) if that ever measures otherwise.
  // `awaitingFirstPull` is the same case one step later: a device that has
  // never cached this account finishes hydrating against an EMPTY store, so
  // every step reads "not done" and a set-up account is told to import a
  // collection it already has.
  if (hydrating || !decksHydrated || awaitingFirstPull) return null;

  const steps: Step[] = [
    { label: 'Import your collection', href: '/collection?add=list', done: cardCount > 0 },
    { label: 'Build your first binder', href: '/collection/binders', done: binderCount > 0 },
    { label: 'Make a deck', href: '/decks/new', done: deckCount > 0 },
  ];

  if (steps.every((step) => step.done)) return null;

  async function handleSamples() {
    const ok = await loadSamples();
    if (!ok) return;
    track('sample_loaded');
    navigate('/collection');
  }

  return (
    <HomeCard title="Get started" icon={Compass} loading={false}>
      <ul className="home-get-started-steps">
        {steps.map((step) =>
          step.done ? (
            <li key={step.label} className="home-get-started-step is-done">
              <Check
                className="home-get-started-step-icon"
                width={16}
                height={16}
                strokeWidth={2.4}
                aria-hidden
              />
              <span>{step.label}</span>
              <span className="sr-only">, done</span>
            </li>
          ) : (
            <li key={step.label}>
              <Link to={step.href} className="home-get-started-step">
                <span className="home-get-started-step-dot" aria-hidden />
                <span>{step.label}</span>
              </Link>
            </li>
          )
        )}
      </ul>

      {cardCount === 0 && (
        <button
          type="button"
          className="pill-btn home-get-started-sample-btn"
          onClick={() => void handleSamples()}
          disabled={loadingSamples}
        >
          {loadingSamples ? 'Loading samples…' : 'Try the sample collection'}
        </button>
      )}
      {sampleError && <p className="home-get-started-error">{sampleError}</p>}

      <a
        href="/guides/"
        className="home-card-view-all home-get-started-guides"
        onClick={() => track('guide_cta')}
      >
        Read the guides
      </a>
    </HomeCard>
  );
}

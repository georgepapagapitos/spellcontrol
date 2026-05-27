import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import {
  registerCollisionHandler,
  type CollisionChoice,
  type CollisionInfo,
} from '../lib/sync-collision';

/**
 * Prompts on the first sign-in for this device whenever the user has any
 * local guest data — whether the server account is empty (the "should we
 * push your local data up?" question) or already has data (the true
 * three-way merge collision). Replaces the historical silent guest-
 * promotion / silent overwrite: every cross-account data movement now
 * has explicit consent.
 *
 * Lifecycle: mounted at the root once (App.tsx). On mount it registers an
 * async handler with sync-collision; the handler awaits the user's click.
 * Only one dialog can be open at a time (sync only invokes the handler on
 * the first pull per device-account), so no queue is needed.
 */
export function AccountMergeDialog() {
  const [active, setActive] = useState<CollisionInfo | null>(null);
  // Pending resolver lives in a ref so a re-render during the modal can't
  // accidentally lose it.
  const resolverRef = useRef<((c: CollisionChoice) => void) | null>(null);

  useEffect(() => {
    const unregister = registerCollisionHandler(
      (info) =>
        new Promise<CollisionChoice>((resolve) => {
          resolverRef.current = resolve;
          setActive(info);
        })
    );
    return () => {
      unregister();
      // If the component unmounts while a prompt is open (only really
      // happens in tests), default to the safest answer so sync can
      // resolve and not hang.
      const r = resolverRef.current;
      resolverRef.current = null;
      if (r) r('keep-server');
    };
  }, []);

  if (!active) return null;

  const choose = (c: CollisionChoice) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setActive(null);
    if (r) r(c);
  };

  const accountLabel = active.accountLabel || 'this account';
  const local = active.local;
  const server = active.server;
  const serverEmpty =
    server.cards === 0 &&
    server.binders === 0 &&
    server.decks === 0 &&
    server.lists === 0 &&
    server.games === 0;

  // Two distinct user questions, two distinct copy + button sets:
  //   1. Server has data → 3-way merge collision.
  //   2. Server is empty → "push your guest data to this account?" with an
  //      escape hatch to wipe local and start fresh on the account.
  // The "merge" branch collapses to "keep-local" when server is empty
  // (union with nothing = local), so we don't bother showing a redundant
  // third button in that case.

  if (serverEmpty) {
    return (
      <Modal
        onClose={() => choose('keep-local')}
        labelledBy="account-merge-dialog-title"
        className="choice-dialog account-merge-dialog"
      >
        <h2 id="account-merge-dialog-title" className="choice-dialog-title">
          Move your local data to this account?
        </h2>
        <p className="choice-dialog-body">
          You signed in as <strong>{accountLabel}</strong>. This account is empty, but this device
          has content. We won&apos;t move anything without your say-so — this only happens once.
        </p>

        <div className="account-merge-grid">
          <SideSummary label="On this device" counts={local} />
          <SideSummary label={`On ${accountLabel}'s account`} counts={server} />
        </div>

        <div className="account-merge-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => choose('keep-local')}
            autoFocus
          >
            Move it to this account
          </button>
          <button type="button" className="btn" onClick={() => choose('keep-server')}>
            Start fresh — drop this device&apos;s data
          </button>
        </div>

        <p className="account-merge-hint">
          <strong>Move it</strong> pushes everything on this device up to your account so it syncs
          across devices. <strong>Start fresh</strong> wipes this device&apos;s local guest data and
          gives you a clean slate on the account.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={() => choose('keep-server')}
      labelledBy="account-merge-dialog-title"
      className="choice-dialog account-merge-dialog"
    >
      <h2 id="account-merge-dialog-title" className="choice-dialog-title">
        This account already has data
      </h2>
      <p className="choice-dialog-body">
        You signed in as <strong>{accountLabel}</strong>. Both this device and your account already
        have content. Choose how to combine them — this only happens once.
      </p>

      <div className="account-merge-grid">
        <SideSummary label="On this device" counts={local} />
        <SideSummary label={`On ${accountLabel}'s account`} counts={server} />
      </div>

      <div className="account-merge-actions">
        <button type="button" className="btn btn-primary" onClick={() => choose('merge')} autoFocus>
          Merge both
        </button>
        <button type="button" className="btn" onClick={() => choose('keep-local')}>
          Keep this device&apos;s data
        </button>
        <button type="button" className="btn" onClick={() => choose('keep-server')}>
          Use account data
        </button>
      </div>

      <p className="account-merge-hint">
        <strong>Merge</strong> keeps everything from both sides — duplicates are kept (no copies are
        lost). <strong>Keep this device&apos;s data</strong> replaces the account with what&apos;s
        here. <strong>Use account data</strong> drops this device&apos;s local guest data.
      </p>
    </Modal>
  );
}

function SideSummary({ label, counts }: { label: string; counts: CollisionInfo['local'] }) {
  return (
    <div className="account-merge-side">
      <div className="account-merge-side-label">{label}</div>
      <ul className="account-merge-side-counts">
        <li>
          <strong>{counts.cards.toLocaleString()}</strong> cards
        </li>
        <li>
          <strong>{counts.binders.toLocaleString()}</strong> binders
        </li>
        <li>
          <strong>{counts.decks.toLocaleString()}</strong> decks
        </li>
        <li>
          <strong>{counts.lists.toLocaleString()}</strong> lists
        </li>
        {counts.games > 0 ? (
          <li>
            <strong>{counts.games.toLocaleString()}</strong> games
          </li>
        ) : null}
      </ul>
    </div>
  );
}

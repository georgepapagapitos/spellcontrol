import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/overlays/Modal';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { heroBracketReadout } from '@/lib/deck-analysis/format-bracket-label';
import { listMyPublications, type OwnedPublication } from '@/lib/social/publications-client';
import { listShares } from '@/lib/social/share-client';
import type { ShareRow } from '@/lib/social/shared-types';
import {
  addPodDeck,
  fetchPodRule0,
  removePodDeck,
  type PodRule0Deck,
} from '@/lib/social/pods-client';
import { gapLine, signalPhrases, spreadLine, widestGap } from '@/lib/social/rule0-notes';
import { userMessage } from '@/lib/util/user-error';
import { toast } from '@/store/toasts';
import { useDecksStore } from '@/store/decks';

type Fetch =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; decks: PodRule0Deck[] };

/**
 * Notes for the pod's Rule 0 conversation: the decks each member chose to bring,
 * with their bracket and what drives it. A member's deck only appears to someone
 * who could already open it (the server checks both). The notes describe decks
 * and never rank a table or say what to do about it.
 */
export function PodRule0Notes({ podId }: { podId: string }) {
  const [fetchState, setFetchState] = useState<Fetch>({ status: 'loading' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // A refresh keeps the current list on screen; only Retry goes back to the skeleton.
  const load = useCallback(() => {
    fetchPodRule0(podId)
      .then((decks) => setFetchState({ status: 'ready', decks }))
      .catch((err) =>
        setFetchState({
          status: 'error',
          message: userMessage(err, "Couldn't load the notes. Try again in a moment."),
        })
      );
  }, [podId]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(deck: PodRule0Deck) {
    setRemoving(deck.deckId);
    try {
      await removePodDeck(podId, deck.deckId);
      load();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't remove that deck. Try again."),
        tone: 'error',
      });
    } finally {
      setRemoving(null);
    }
  }

  const decks = useMemo(
    () => (fetchState.status === 'ready' ? fetchState.decks : []),
    [fetchState]
  );
  // The spread and gap describe what the table will see: your own deck counts
  // only once the pod can see it too.
  const shown = useMemo(() => decks.filter((d) => d.reach !== 'private'), [decks]);
  const spread = spreadLine(shown);
  const gap = widestGap(shown);

  return (
    <section className="pod-hub-section pod-rule0" aria-label="Rule 0 notes">
      <SectionHeader
        title="Rule 0 notes"
        titleClassName="pod-hub-section-head"
        variant="overline"
      />
      <p className="pod-rule0-intro">
        Notes for the pregame talk. Each member picks the decks they bring, and you only see decks
        you could already open. They describe decks; they don't rank anyone.
      </p>

      {fetchState.status === 'loading' ? (
        <div
          className="pod-hub-table-skeleton"
          role="status"
          aria-label="Loading"
          aria-busy="true"
        />
      ) : fetchState.status === 'error' ? (
        <p className="friends-error" role="alert">
          <span>{fetchState.message}</span>
          <Button
            onClick={() => {
              setFetchState({ status: 'loading' });
              load();
            }}
            className="friends-error-retry"
          >
            Retry
          </Button>
        </p>
      ) : (
        <>
          {decks.length === 0 ? (
            <EmptyState compact as="div" className="pod-hub-stats-empty pod-hub-stats-empty-cta">
              <p>No decks in the notes yet. Choose the ones you're bringing.</p>
            </EmptyState>
          ) : (
            <>
              {spread && <p className="pod-rule0-spread">{spread}</p>}
              {gap && <p className="pod-rule0-gap">{gapLine(gap)}</p>}
              <ul className="list-stack pod-rule0-list" aria-label="Decks in the notes">
                {decks.map((d) => (
                  <RuleZeroRow
                    key={`${d.userId}:${d.deckId}`}
                    deck={d}
                    removing={removing === d.deckId}
                    onRemove={() => void remove(d)}
                  />
                ))}
              </ul>
            </>
          )}
          <div className="pod-rule0-actions">
            <Button onClick={() => setPickerOpen(true)}>Choose your decks</Button>
          </div>
        </>
      )}

      {pickerOpen && (
        <ChooseDecksDialog
          podId={podId}
          chosen={new Set(decks.filter((d) => d.mine).map((d) => d.deckId))}
          onClose={() => setPickerOpen(false)}
          onChanged={load}
        />
      )}
    </section>
  );
}

function RuleZeroRow({
  deck,
  removing,
  onRemove,
}: {
  deck: PodRule0Deck;
  removing: boolean;
  onRemove: () => void;
}) {
  const readout =
    deck.bracket === null
      ? null
      : heroBracketReadout({
          bracket: deck.bracket,
          stated: deck.bracketStated ? deck.bracket : null,
          estimate: deck.estimatedBracket ?? undefined,
          missesCombos: deck.estimateIsFloor,
        });
  const phrases = deck.signals ? signalPhrases(deck.signals) : [];
  return (
    <li className="pod-rule0-row">
      <div className="pod-rule0-head">
        <span className="pod-rule0-name" title={deck.name}>
          {deck.name}
        </span>
        {readout ? (
          <Chip tone="accent" className="pod-rule0-bracket" aria-label={readout.aria}>
            {readout.text}
            {!deck.bracketStated && <span className="pod-rule0-basis"> est.</span>}
          </Chip>
        ) : (
          <Chip tone="neutral" className="pod-rule0-bracket">
            Not rated yet
          </Chip>
        )}
      </div>
      <p className="pod-rule0-meta">
        {deck.mine ? 'You' : deck.username}
        {deck.commanderName ? ` · ${deck.commanderName}` : ''}
      </p>
      {deck.signals &&
        (phrases.length > 0 ? (
          <ul className="pod-rule0-signals" aria-label="What drives the bracket">
            {phrases.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="pod-rule0-meta">No Game Changers, combos, land denial or extra turns.</p>
        ))}
      {deck.signals && deck.signals.gameChangerNames.length > 0 && (
        <p className="pod-rule0-meta">Game Changers: {deck.signals.gameChangerNames.join(', ')}</p>
      )}
      {deck.mine && deck.reach === 'private' && (
        <p className="pod-rule0-warn" role="status">
          Only you can see this one now. Share it with friends or publish it so the pod can.
        </p>
      )}
      {deck.mine && (
        <div className="pod-rule0-row-actions">
          <Button
            placement="row"
            variant="danger"
            onClick={onRemove}
            disabled={removing}
            aria-label={`Take ${deck.name} out of the notes`}
          >
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      )}
    </li>
  );
}

type Eligibility =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; publications: OwnedPublication[]; shares: ShareRow[] };

function ChooseDecksDialog({
  podId,
  chosen,
  onClose,
  onChanged,
}: {
  podId: string;
  chosen: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const titleId = useId();
  const decks = useDecksStore((s) => s.decks);
  const commanderDecks = useMemo(() => decks.filter((d) => d.format === 'commander'), [decks]);
  const [elig, setElig] = useState<Eligibility>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(chosen);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyPublications(), listShares()])
      .then(([publications, shares]) => {
        if (!cancelled) setElig({ status: 'ready', publications, shares });
      })
      .catch(() => {
        if (!cancelled) setElig({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Only a live publication or a live friends share reaches pod members. */
  function reachOf(deckId: string): 'public' | 'friends' | 'private' {
    if (elig.status !== 'ready') return 'private';
    if (elig.publications.some((p) => p.deckId === deckId && !p.unpublishedAt)) return 'public';
    const friends = elig.shares.some(
      (s) =>
        !s.revokedAt && s.kind === 'deck' && s.resourceId === deckId && s.audience === 'friends'
    );
    return friends ? 'friends' : 'private';
  }

  async function toggle(deckId: string, next: boolean) {
    setBusyId(deckId);
    setFormError(null);
    try {
      if (next) await addPodDeck(podId, deckId);
      else await removePodDeck(podId, deckId);
      setPicked((prev) => {
        const s = new Set(prev);
        if (next) s.add(deckId);
        else s.delete(deckId);
        return s;
      });
      onChanged();
    } catch (err) {
      setFormError(userMessage(err, "Couldn't update the notes. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} dismissable={busyId === null}>
      <div className="pod-hub-invite-dialog">
        <h2 id={titleId} className="pod-hub-invite-dialog-title">
          Choose your decks
        </h2>
        <p className="pod-hub-invite-hint">
          Members of this pod see these decks' brackets if they could already open the deck. A deck
          has to be shared with friends or published first.
        </p>
        <fieldset className="pod-hub-invite-fieldset">
          <legend>Your Commander decks</legend>
          {elig.status === 'loading' ? (
            <p className="pod-hub-invite-hint" role="status">
              Loading your decks…
            </p>
          ) : elig.status === 'error' ? (
            <p className="pod-hub-invite-hint" role="alert">
              Couldn't check who can see your decks. Try again shortly.
            </p>
          ) : commanderDecks.length === 0 ? (
            <p className="pod-hub-invite-hint">You don't have a Commander deck yet.</p>
          ) : (
            <ul className="pod-hub-invite-list">
              {commanderDecks.map((d) => {
                const reach = reachOf(d.id);
                const isPicked = picked.has(d.id);
                const blocked = reach === 'private' && !isPicked;
                const hintId = `${titleId}-${d.id}`;
                return (
                  <li key={d.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={isPicked}
                        disabled={blocked || busyId !== null}
                        aria-describedby={blocked ? hintId : undefined}
                        onChange={(e) => void toggle(d.id, e.target.checked)}
                      />
                      <span>{d.name}</span>
                    </label>
                    {blocked && (
                      <span id={hintId} className="pod-rule0-pick-hint">
                        Private.{' '}
                        <Link to={`/decks/${d.id}`} onClick={onClose}>
                          Share or publish it
                        </Link>{' '}
                        first.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        {formError && (
          <p className="pod-hub-form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="pod-hub-invite-actions">
          <Button variant="primary" onClick={onClose} disabled={busyId !== null}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

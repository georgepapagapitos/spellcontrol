import { useEffect, useId, useState, type JSX } from 'react';
import type { BracketEstimation } from '@spellcontrol/deck-metrics';
import { useAuth } from '../../store/auth';
import { Button } from '@/components/shared/Button';
import { Field } from '../shared/form';
import {
  BRACKET_NOTE_MAX,
  deckFingerprint,
  fetchBracketVote,
  sendBracketVote,
  type BracketVote as SavedVote,
} from '@/lib/deck-analysis/bracket-vote';

/**
 * "Does this look right?" in the Bracket panel: the owner's label on the
 * estimate, for calibration. It reuses the stated Bracket the "Which does your
 * table play it at?" radios set, so there is no second picker: a stated
 * Bracket that differs from the estimate is a disagreement, anything else is
 * "Looks right". Signed in only; the label is personal and never shown to
 * anyone else.
 */
export function BracketVote({
  deckId,
  listText,
  estimation,
  stated,
}: {
  deckId: string;
  /** The deck's card list as `deckListText` writes it; its hash names the content voted on. */
  listText: string;
  estimation: BracketEstimation;
  /** The owner's stated Bracket, or null on Auto. */
  stated: number | null;
}): JSX.Element | null {
  const signedIn = useAuth((s) => s.user != null);
  const noteId = useId();
  // What the server holds for the list last hashed. It belongs to that list
  // alone: once the list changes, `loaded` no longer matches and reads as unset.
  const [loaded, setLoaded] = useState<{
    listText: string;
    hash: string;
    saved: SavedVote | null;
  } | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = loaded?.listText === listText ? loaded : null;
  const hash = current?.hash ?? null;
  const saved = current?.saved ?? null;

  // The fingerprint follows the card list; the stored label follows the fingerprint.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void deckFingerprint(listText)
      .then(async (h) => {
        const vote = await fetchBracketVote(deckId, h).catch(() => null);
        if (!live) return;
        setLoaded({ listText, hash: h, saved: vote });
        setNote(vote?.note ?? '');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn, deckId, listText]);

  if (!signedIn) return null;

  const estimated = estimation.bracket;
  const answer = stated ?? estimated;
  const disagrees = answer !== estimated;
  const trimmed = note.trim();
  const unchanged =
    saved != null &&
    saved.statedBracket === answer &&
    saved.estimatedBracket === estimated &&
    saved.note === trimmed;

  async function send() {
    if (!hash || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const vote = await sendBracketVote({
        deckId,
        deckHash: hash,
        estimation,
        statedBracket: answer,
        note: trimmed,
      });
      setLoaded({ listText, hash, saved: vote });
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bracket-breakdown-section bracket-vote">
      <h4 className="bracket-breakdown-heading">Does this look right?</h4>
      <p className="bracket-vote-line">
        {disagrees
          ? `You set Bracket ${answer}. The estimate is Bracket ${estimated}.`
          : `The estimate is Bracket ${estimated}.`}
      </p>
      <Field
        label="Note (optional)"
        htmlFor={noteId}
        hint={`Only you and the SpellControl team see this. ${trimmed.length}/${BRACKET_NOTE_MAX}`}
      >
        <textarea
          id={noteId}
          className="form-input"
          rows={2}
          maxLength={BRACKET_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="bracket-vote-actions">
        <Button onClick={() => void send()} disabled={!hash || sending || unchanged}>
          {sending ? 'Sending…' : disagrees ? 'Send feedback' : 'Looks right'}
        </Button>
        {unchanged && (
          <span className="bracket-vote-status" role="status">
            Sent.
          </span>
        )}
      </div>
      {failed && (
        <p className="error-banner" role="alert">
          Couldn't send that. Try again.
        </p>
      )}
    </div>
  );
}

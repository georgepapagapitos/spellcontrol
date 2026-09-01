import { useState, type FormEvent } from 'react';
import { useOnlineSignals } from '../hooks/use-online-signals';
import { MAX_CHAT_LEN } from '../lib/table-signals';
import './TableChat.css';

interface Props {
  /** Marks the composer's own label/field so two mounted instances (the rail
   *  panel and the Log sheet's Table tab can both be live on a tablet) don't
   *  collide on element ids. */
  idPrefix: string;
}

/**
 * Table chat composer — the send half of the chat lane; incoming messages
 * render as `kind: 'chat'` lines in the shared ticker feed (TableTicker.tsx),
 * not here.
 *
 * This is the affordance that makes a manual-enforcement table workable.
 * SpellControl already has the *structured* table asks — a hold, a takeback
 * consent vote — but every real Commander table also runs on unstructured
 * talk ("that resolves?", "take 3 from the Ohran Viper", "sorry, misclick"),
 * and without it a player's only vocabulary was six fixed emotes. Deliberately
 * text-only: voice is the one feature the comparable tables put behind a
 * paywall, and it needs an entirely different transport than this app's
 * SSE/long-poll signal channel.
 *
 * Renders nothing outside an online, seated game — `useOnlineSignals` returns
 * null in solo playtest, same gate ReactionPicker and TableSignals use.
 */
export function TableChat({ idPrefix }: Props) {
  const linked = useOnlineSignals();
  const [draft, setDraft] = useState('');

  if (!linked) return null;

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_CHAT_LEN;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    // Cleared optimistically: the message comes back through the signal
    // channel like everyone else's (there is no local echo to reconcile), and
    // a send is best-effort — `sendSignal` swallows failures, so holding the
    // draft hostage waiting for a confirmation that never arrives would leave
    // the box stuck full after every hiccup.
    setDraft('');
    void linked?.sendSignal({ kind: 'chat', text: trimmed });
  }

  const fieldId = `${idPrefix}-table-chat`;
  return (
    <form className="table-chat" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={fieldId}>
        Message the table
      </label>
      <input
        id={fieldId}
        className="table-chat__input"
        type="text"
        // Enter submits via the form; the board's own single-key shortcuts
        // (draw, untap, shuffle) are bound at the document level, so typing
        // "u" in here must not untap anybody. Keystrokes are stopped from
        // reaching them rather than the handlers being taught about focus.
        onKeyDown={(e) => e.stopPropagation()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Message the table"
        maxLength={MAX_CHAT_LEN}
        autoComplete="off"
      />
      <button type="submit" className="table-chat__send" disabled={!canSend}>
        Send
      </button>
    </form>
  );
}

import { useCallback, useId, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useNavigate } from 'react-router-dom';
import { importDeckText } from '@/lib/api';
import { userMessage } from '@/lib/user-error';
import { useDocumentTitle } from '@/lib/use-document-title';
import { importToDeck, pastedDeckLocalId, pastedListToken } from '@/lib/import-to-deck';
import { PlaytestSession } from '@/playtest/components/PlaytestSession';
import { toast } from '@/store/toasts';
import type { Deck } from '@/store/decks';
import '@/styles/playtest.css';
import './GoldfishListPage.css';
import { Button } from '@/components/shared/Button';

type State =
  | { status: 'input' }
  | { status: 'parsing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; deck: Deck };

/** Fewer cards than this is almost always a paste that went wrong. */
const MIN_CARDS = 2;

/**
 * Goldfish a list you have not saved, at `/decks/goldfish`.
 *
 * Every other way onto a board needs a deck that already exists somewhere:
 * yours in the decks store, or a published one behind a share link. Pasting a
 * list from a forum post, a primer or a friend meant importing it first, which
 * left behind a deck nobody wanted. This is the same board with nothing
 * written down — the parsed list lives in this component and dies with it.
 *
 * The parse is the backend's existing import endpoint, so every format its
 * auto-detection already handles works here for free.
 */
export function GoldfishListPage() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [state, setState] = useState<State>({ status: 'input' });
  const fieldId = useId();
  useDocumentTitle(state.status === 'ready' ? `Goldfish: ${state.deck.name}` : 'Goldfish a list');

  const parse = useCallback(async () => {
    const list = text.trim();
    if (!list) return;
    setState({ status: 'parsing' });
    try {
      const result = await importDeckText(list);
      if (result.cards.length + (result.commander ? 1 : 0) < MIN_CARDS) {
        setState({
          status: 'error',
          message:
            "That didn't read as a decklist. Paste one card per line, with or without counts.",
        });
        return;
      }
      // Say what was dropped rather than quietly dealing a short deck. The
      // board is about to take over the screen, so this belongs in a toast,
      // not in a layer above a fixed-position board.
      const missed = result.unresolvedNames.length;
      if (missed > 0) {
        toast.show({
          tone: 'warn',
          message: `${missed} line${missed === 1 ? '' : 's'} didn't match a card and ${missed === 1 ? 'is' : 'are'} not in this game.`,
        });
      }
      setState({
        status: 'ready',
        deck: importToDeck(
          result,
          pastedDeckLocalId(pastedListToken(list)),
          result.commander?.name ?? 'Pasted list'
        ),
      });
    } catch (err) {
      setState({
        status: 'error',
        message: userMessage(err, "Couldn't read that list. Check the text and try again."),
      });
    }
  }, [text]);

  if (state.status === 'ready') {
    return (
      <PlaytestSession
        deck={state.deck}
        external
        back={{ label: 'Goldfish a list', to: '/decks/goldfish' }}
        title="Goldfish"
        emptyHint="That list came back empty. Go back and paste it again."
      />
    );
  }

  const busy = state.status === 'parsing';

  return (
    <div className="goldfish-page">
      <PageHeader
        title="Goldfish a list"
        className="goldfish-header"
        meta="Paste a decklist and play it. Nothing is saved, and it never touches your decks."
      />

      <label className="goldfish-label" htmlFor={fieldId}>
        The list
      </label>
      <textarea
        id={fieldId}
        className="goldfish-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        spellCheck={false}
        disabled={busy}
        placeholder={'1 Sol Ring\n1 Arcane Signet\n30 Island'}
      />

      {state.status === 'error' && (
        <p className="goldfish-error" role="alert">
          {state.message}
        </p>
      )}

      <div className="goldfish-actions">
        <Button onClick={() => navigate('/decks')} disabled={busy}>
          Back to decks
        </Button>
        <Button variant="primary" onClick={parse} disabled={busy || text.trim().length === 0}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Reading the list…
            </>
          ) : (
            'Play this list'
          )}
        </Button>
      </div>
    </div>
  );
}

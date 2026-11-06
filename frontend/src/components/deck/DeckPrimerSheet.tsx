import { type JSX, useEffect, useId, useRef, useState } from 'react';
import { Sheet } from '@/components/overlays/Sheet';
import { useDecksStore, type Deck } from '../../store/decks';
import './DeckPrimerSheet.css';

const PRIMER_MAX = 4000;
const COUNTER_THRESHOLD = 200;
const COUNTER_WARN = 50;
const AUTOSAVE_MS = 600;

interface Props {
  deck: Deck;
  onClose: () => void;
}

/**
 * Strategy-notes editor for the deck primer, opened from the deck editor's ⋮
 * menu. Rides the shared `card-picker` sheet shell like its deck-editor
 * siblings (DeckFeedbackSheet, DeckTokensSheet). Autosaves 600ms after the
 * user stops typing — a genuine edit (bumps `updatedAt`, syncs normally), so
 * there's no Save button and no "saved" toast, matching every other deck
 * field's autosave.
 */
export function DeckPrimerSheet({ deck, onClose }: Props): JSX.Element {
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const [text, setText] = useState(deck.primer ?? '');
  const savedRef = useRef(deck.primer ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const counterId = useId();

  // Cursor at the end on open, whether the primer is empty or pre-filled —
  // a controlled textarea's default autoFocus lands the caret at position 0.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    if (text === savedRef.current) return;
    const t = setTimeout(() => {
      savedRef.current = text;
      updateDeck(deck.id, { primer: text });
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [text, deck.id, updateDeck]);

  const remaining = PRIMER_MAX - text.length;
  const showCounter = remaining < COUNTER_THRESHOLD;

  return (
    <Sheet onClose={onClose} className="deck-primer-sheet" title="Primer" closeButton>
      <div className="deck-primer-sheet-body">
        <label className="deck-primer-sheet-label" htmlFor={textareaId}>
          Strategy notes
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          className="deck-primer-sheet-textarea"
          value={text}
          maxLength={PRIMER_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add strategy notes for people viewing this deck"
          aria-describedby={showCounter ? counterId : undefined}
        />
        <p className="deck-primer-sheet-hint">
          Markdown-lite: <strong>**bold**</strong>, <em>*italic*</em>, blank-line paragraphs, -
          lists
        </p>
        {showCounter && (
          <p
            id={counterId}
            className={`deck-primer-sheet-counter${
              remaining < COUNTER_WARN ? ' deck-primer-sheet-counter--warn' : ''
            }`}
            aria-live="polite"
          >
            {remaining} character{remaining === 1 ? '' : 's'} left
          </p>
        )}
      </div>
    </Sheet>
  );
}

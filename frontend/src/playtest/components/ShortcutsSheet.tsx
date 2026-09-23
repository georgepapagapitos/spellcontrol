import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import {
  CARD_GROUP_HELP,
  SHORTCUTS,
  SHORTCUT_GROUP_LABEL,
  chordOf,
  formatChord,
  rebind,
  resolveBindings,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutOverrides,
} from '../lib/shortcuts';

interface Props {
  overrides: ShortcutOverrides;
  onChange(next: ShortcutOverrides): void;
  onClose(): void;
}

const GROUP_ORDER: ShortcutGroup[] = ['global', 'card', 'counters', 'players', 'reactions'];

/**
 * The table's keyboard shortcuts, each one rebindable in place: press the key
 * chip, then the key you want. Esc cancels; Backspace or Delete switches an
 * optional shortcut off. A key already in use moves off the other shortcut
 * and the sheet says which one, so nothing is ever bound twice.
 */
export function ShortcutsSheet({ overrides, onChange, onClose }: Props) {
  const bindings = resolveBindings(overrides);
  const [listening, setListening] = useState<ShortcutId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const id = listening;
    const def = SHORTCUTS.find((d) => d.id === id)!;
    function onKey(e: KeyboardEvent) {
      // Captured ahead of the modal's own Esc-to-close and the board's
      // handler: while a chip listens, the next key is an answer, not a command.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (def.optional) {
          onChange(rebind(overrides, id, '').next);
          setNotice(`${def.label} is off.`);
        } else {
          setNotice(`${def.label} always needs a key. Press the one you want.`);
          return;
        }
        setListening(null);
        return;
      }
      const chord = chordOf(e);
      if (chord === null) return;
      const { next, displaced } = rebind(overrides, id, chord);
      onChange(next);
      const other = displaced ? SHORTCUTS.find((d) => d.id === displaced) : null;
      setNotice(
        other
          ? `${formatChord(chord)} is now ${def.label}. ${other.label} ${
              resolveBindings(next)[other.id]
                ? `moved to ${formatChord(resolveBindings(next)[other.id])}`
                : 'is off'
            }.`
          : `${formatChord(chord)} is now ${def.label}.`
      );
      setListening(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, overrides, onChange]);

  const changed = Object.keys(overrides).length > 0;

  return (
    <Modal
      onClose={onClose}
      labelledBy="playtest-shortcuts-title"
      className="shortcuts-overlay playtest-shortcuts"
    >
      <header className="shortcuts-overlay-head">
        <h2 id="playtest-shortcuts-title" className="shortcuts-overlay-title">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          className="shortcuts-overlay-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <p className="playtest-shortcuts-help">
        Press any key to change it. Esc cancels. Backspace or Delete turns an optional shortcut off.
      </p>
      <p className="playtest-shortcuts-notice" role="status" aria-live="polite">
        {notice ?? ''}
      </p>
      <div className="shortcuts-overlay-body">
        {GROUP_ORDER.map((group) => (
          <section key={group}>
            <h3 className="shortcuts-overlay-section-title">{SHORTCUT_GROUP_LABEL[group]}</h3>
            {group === 'card' && <p className="playtest-shortcuts-group-help">{CARD_GROUP_HELP}</p>}
            <ul className="shortcuts-overlay-list">
              {SHORTCUTS.filter((d) => d.group === group).map((def) => {
                const chord = bindings[def.id];
                const isListening = listening === def.id;
                return (
                  <li key={def.id} className="shortcuts-overlay-row">
                    <button
                      type="button"
                      className={`playtest-shortcut-key${isListening ? ' is-listening' : ''}${
                        chord ? '' : ' is-off'
                      }`}
                      aria-label={`${def.label}: ${
                        isListening ? 'press a key' : chord ? formatChord(chord) : 'not set'
                      }. Change`}
                      aria-pressed={isListening}
                      onClick={() => {
                        setNotice(null);
                        setListening(isListening ? null : def.id);
                      }}
                    >
                      {isListening ? 'Press a key…' : formatChord(chord)}
                    </button>
                    <span className="shortcuts-overlay-desc">{def.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <footer className="playtest-shortcuts-foot">
        <button
          type="button"
          className="btn"
          disabled={!changed}
          onClick={() => {
            onChange({});
            setListening(null);
            setNotice('Back to the defaults.');
          }}
        >
          Reset to defaults
        </button>
      </footer>
    </Modal>
  );
}

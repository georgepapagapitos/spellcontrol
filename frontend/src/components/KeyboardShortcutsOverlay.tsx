import { X } from 'lucide-react';
import { Modal } from './Modal';
import { IconButton } from './shared/Button';

interface Shortcut {
  keys: string[];
  description: string;
  /**
   * How multiple `keys` entries relate. 'alt' (default): each entry is a
   * complete alternative binding (e.g. platform-conditional ⌘K vs Ctrl+K),
   * rendered as separate kbd chips joined by "/". 'chord': entries are parts
   * of one combo (e.g. ['Cmd/Ctrl', 'Z']), rendered as a single kbd joined by
   * "+". No shortcut in this codebase is a true multi-step sequence today —
   * add a third variant if one ever is, rather than overloading either of
   * these.
   */
  join?: 'alt' | 'chord';
}

interface Group {
  title: string;
  shortcuts: Shortcut[];
}

interface Props {
  groups: Group[];
  onClose: () => void;
}

export function KeyboardShortcutsOverlay({ groups, onClose }: Props) {
  return (
    <Modal onClose={onClose} labelledBy="shortcuts-overlay-title" className="shortcuts-overlay">
      <header className="shortcuts-overlay-head">
        <h2 id="shortcuts-overlay-title" className="shortcuts-overlay-title">
          Keyboard shortcuts
        </h2>
        <IconButton
          className="shortcuts-overlay-close"
          onClick={onClose}
          label="Close"
          icon={<X width={18} height={18} strokeWidth={2} />}
        />
      </header>
      <div className="shortcuts-overlay-body">
        {groups.map((g) => (
          <section key={g.title} className="shortcuts-overlay-section">
            <h3 className="shortcuts-overlay-section-title">{g.title}</h3>
            <ul className="shortcuts-overlay-list">
              {g.shortcuts.map((s) => (
                <li key={s.description} className="shortcuts-overlay-row">
                  <span className="shortcuts-overlay-keys">
                    {s.join === 'chord' ? (
                      <kbd className="shortcuts-overlay-kbd">{s.keys.join('+')}</kbd>
                    ) : (
                      s.keys.map((k, i) => (
                        <span key={i} className="shortcuts-overlay-key-group">
                          {i > 0 && <span className="shortcuts-overlay-sep">/</span>}
                          <kbd className="shortcuts-overlay-kbd">{k}</kbd>
                        </span>
                      ))
                    )}
                  </span>
                  <span className="shortcuts-overlay-desc">{s.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

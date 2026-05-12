import { Modal } from './Modal';

interface Shortcut {
  keys: string[];
  description: string;
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
        <button
          type="button"
          className="shortcuts-overlay-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>
      <div className="shortcuts-overlay-body">
        {groups.map((g) => (
          <section key={g.title} className="shortcuts-overlay-section">
            <h3 className="shortcuts-overlay-section-title">{g.title}</h3>
            <ul className="shortcuts-overlay-list">
              {g.shortcuts.map((s) => (
                <li key={s.description} className="shortcuts-overlay-row">
                  <span className="shortcuts-overlay-keys">
                    {s.keys.map((k, i) => (
                      <span key={i} className="shortcuts-overlay-key-group">
                        {i > 0 && <span className="shortcuts-overlay-sep">then</span>}
                        <kbd className="shortcuts-overlay-kbd">{k}</kbd>
                      </span>
                    ))}
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

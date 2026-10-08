import { useId, useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import './HiddenSuggestions.css';
import { Button } from '@/components/shared/Button';
import { useDismissedSuggestions } from '@/lib/coach/dismissed-suggestions';

/**
 * The way back for suggestions hidden with "Not for this deck" (E580): one quiet
 * line that opens the list, each entry with a Show again. It renders nothing
 * while no suggestion is hidden, so a deck the player never curated pays no
 * chrome for it; once opened it stays until closed, so restoring the last entry
 * lands on the empty line instead of making the panel vanish under the pointer.
 */
export function HiddenSuggestions(): JSX.Element | null {
  const { list, restore, restoreAll } = useDismissedSuggestions();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (list.length === 0 && !open) return null;

  return (
    <section className="hidden-suggestions" aria-label="Hidden suggestions">
      <button
        type="button"
        className="hidden-suggestions-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
        Hidden for this deck{list.length > 0 ? ` (${list.length})` : ''}
      </button>
      {open && (
        <div id={panelId} className="hidden-suggestions-panel">
          {list.length === 0 ? (
            <p className="hidden-suggestions-empty">
              Nothing hidden. Suggestions you hide from a row's menu show up here.
            </p>
          ) : (
            <>
              <ul className="hidden-suggestions-list">
                {list.map((d) => (
                  <li key={`${d.cut ? 'cut' : 'add'}:${d.name}`} className="hidden-suggestions-row">
                    <span className="hidden-suggestions-name">
                      {d.name}
                      {d.cut && <span className="hidden-suggestions-kind"> as a cut</span>}
                    </span>
                    <Button
                      variant="link"
                      aria-label={`Show ${d.name} again${d.cut ? ' as a cut' : ''}`}
                      onClick={() => restore(d)}
                    >
                      Show again
                    </Button>
                  </li>
                ))}
              </ul>
              {list.length > 1 && (
                <Button variant="link" onClick={restoreAll}>
                  Show all again
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

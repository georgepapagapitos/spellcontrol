import { Swords } from 'lucide-react';
import './PlaytestLogSheet.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { formatLogForClipboard, groupLogByTurn, type GameLogEntry } from '@/lib/playtest/game-log';
import { toast } from '@/store/toasts';

interface Props {
  log: GameLogEntry[];
  onClose(): void;
}

export function PlaytestLogSheet({ log, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);

  const groups = [...groupLogByTurn(log)].reverse(); // newest turn first

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatLogForClipboard(log));
      toast.show({ message: 'Game log copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  }

  return (
    <div className="card-picker-root" role="presentation">
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-log-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-log-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-header">
          <h2 id="playtest-log-title" className="card-picker-title">
            Log
          </h2>
        </div>

        <div className="playtest-log-body">
          {log.length === 0 ? (
            <p className="playtest-log-empty">Nothing yet — play some cards.</p>
          ) : (
            groups.map((group) => (
              <section key={`${group.turn}-${group.entries[0].seq}`} className="playtest-log-turn">
                <h3 className="playtest-log-turn__heading">Turn {group.turn}</h3>
                <ol className="playtest-log-entries">
                  {group.entries
                    .filter((e) => e.kind !== 'turn')
                    .map((e) => (
                      <li
                        key={e.seq}
                        className={`playtest-log-entry${
                          e.kind === 'resistance' ? ' playtest-log-entry--resistance' : ''
                        }`}
                      >
                        {e.kind === 'resistance' && (
                          <Swords className="playtest-log-entry__icon" aria-hidden size={14} />
                        )}
                        <span>{e.text}</span>
                      </li>
                    ))}
                </ol>
              </section>
            ))
          )}
        </div>

        <div className="card-picker-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCopy}
            disabled={log.length === 0}
          >
            Copy log
          </button>
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

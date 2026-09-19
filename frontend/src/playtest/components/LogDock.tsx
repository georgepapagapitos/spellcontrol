import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Moon, Sunrise, Swords, Wand, X } from 'lucide-react';
import { GAME_PHASES, type GamePhase } from '@/lib/game-state';
import './LogDock.css';
import {
  formatLogForClipboard,
  groupLogByTurn,
  type GameLogEntry,
  type LogEntryKind,
} from '@/lib/playtest/game-log';
import { toast } from '@/store/toasts';
import type { TickerItem } from '@/store/play';
import { TickerLine } from './TableTicker';
import { TableChat } from './TableChat';

interface Props {
  log: GameLogEntry[];
  /** Present only when seated at an online table. */
  table?: { items: TickerItem[]; nameFor(seat: number): string };
  onClose(): void;
  /** Route that renders this same log alone (`/decks/:id/playtest/log`); when
   *  given, the header offers "Open in its own window". Absent in the page
   *  variant, which IS that window. */
  popoutHref?: string;
  /** `dock` floats over the table; `page` fills its window (the pop-out). */
  variant?: 'dock' | 'page';
  /**
   * The online table's phase clock, shown as a strip of five phase icons
   * under the header, the reading an EDHPlay log gives at a glance. `mine`
   * (it is this seat's turn) makes them buttons that set the phase;
   * otherwise they only show where the turn is. Absent off the table.
   */
  phase?: { current: GamePhase | undefined; mine: boolean; onSet(phase: GamePhase): void };
}

type Filter = 'all' | 'cards' | 'life' | 'turns' | 'table';

const FILTER_KEY = 'spellcontrol:playtest:log-filter';

/**
 * Which chip a log kind answers to. Exhaustive over `LogEntryKind` on purpose:
 * a new kind has to be placed here or typecheck fails. `null` means the entry
 * only appears under All. `resistance` (the opponent's threat line) and
 * `designation` (Monarch / Initiative) are neither cards, life totals, nor
 * turn structure, and inventing a chip for two kinds would cost more chrome
 * than it buys.
 */
const CHIP_FOR: Record<LogEntryKind, Filter | null> = {
  turn: 'turns',
  undo: 'turns',
  reset: 'turns',
  life: 'life',
  counter: 'life', // player counters (poison, energy) are player totals
  draw: 'cards',
  play: 'cards',
  'zone-move': 'cards',
  mulligan: 'cards',
  shuffle: 'cards',
  scry: 'cards',
  mill: 'cards',
  token: 'cards',
  'tap-all': 'cards',
  attach: 'cards',
  'card-counter': 'cards',
  face: 'cards',
  phase: 'cards', // a permanent phasing out/in, not a turn phase
  mana: 'cards',
  resistance: null,
  designation: null,
};

/** These read as the app narrating, not as something you did. */
const SYSTEM_KINDS = new Set<LogEntryKind>(['undo', 'reset', 'turn']);

function readFilter(): Filter {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    if (saved === 'cards' || saved === 'life' || saved === 'turns' || saved === 'table') {
      return saved;
    }
  } catch {
    // Private mode / blocked storage: the default is fine.
  }
  return 'all';
}

/**
 * The table's event log, as a floating dock rather than a sheet: it stays open
 * while you play and never covers the board. Non-modal by construction: no
 * backdrop, no scroll lock, no focus trap, and Escape only closes it when
 * focus is already inside (the handler sits on the aside, so a keystroke aimed
 * at the board never reaches it).
 *
 * No pop-out button: opening the log in its own window would need a route that
 * renders the log alone, fed by this tab's live game state, and there is no
 * such route.
 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function LogDock({ log, table, onClose, popoutHref, variant = 'dock', phase }: Props) {
  const [saved, setFilter] = useState<Filter>(readFilter);
  const filter = saved === 'table' && !table ? 'all' : saved;
  const bodyRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(true);

  // Bound to the dock's own node rather than the document, so Escape closes it
  // only when focus is already inside; a keystroke aimed at the board never
  // reaches this. A real listener, not a JSX handler: a region is not an
  // interactive element, and jsx-a11y rightly rejects one that behaves like it.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function choose(next: Filter) {
    setFilter(next);
    try {
      localStorage.setItem(FILTER_KEY, next);
    } catch {
      // Storage is a convenience here, never a correctness requirement.
    }
  }

  const showTable = table !== undefined && filter === 'table';

  // Newest line at the bottom, chat-style, unless the reader has scrolled up
  // to read back, in which case the "New" pill hands the bottom back.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [log, table?.items, stuck, showTable]);

  function handleScroll() {
    const el = bodyRef.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight <= 40);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatLogForClipboard(log));
      toast.show({ message: 'Game log copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  }

  const groups = groupLogByTurn(log)
    .map((g) => ({
      ...g,
      // The divider already says "Turn N"; a bubble repeating it is noise.
      entries: g.entries.filter(
        (e) => e.kind !== 'turn' && (filter === 'all' || CHIP_FOR[e.kind] === filter)
      ),
    }))
    // Under Turns the dividers ARE the content, so an empty turn still shows.
    .filter((g) => g.entries.length > 0 || filter === 'turns');

  const chips: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'cards', label: 'Cards' },
    { id: 'life', label: 'Life' },
    { id: 'turns', label: 'Turns' },
    ...(table ? [{ id: 'table' as const, label: 'Table' }] : []),
  ];

  return (
    <aside
      className={`playtest-log-dock${showTable ? ' is-chatting' : ''}${
        variant === 'page' ? ' playtest-log-dock--page' : ''
      }`}
      role="region"
      aria-label="Game log"
      ref={dockRef}
    >
      <div className="playtest-log-dock__header">
        <h2 className="playtest-log-dock__title">Log</h2>
        <button
          type="button"
          className="playtest-log-dock__btn"
          aria-label="Copy log"
          onClick={handleCopy}
          disabled={log.length === 0}
        >
          <Copy aria-hidden size={16} />
        </button>
        {popoutHref && (
          <button
            type="button"
            className="playtest-log-dock__btn"
            aria-label="Open the log in its own window"
            onClick={() => {
              // A sibling window on the same origin: it reads the same saved
              // session and follows it through `storage` events, so the log
              // can live on a second screen while the table keeps the first.
              window.open(popoutHref, 'spellcontrol-playtest-log', 'popup,width=440,height=680');
            }}
          >
            <ExternalLink aria-hidden size={16} />
          </button>
        )}
        <button
          type="button"
          className="playtest-log-dock__btn"
          aria-label="Close log"
          onClick={onClose}
        >
          <X aria-hidden size={16} />
        </button>
      </div>

      {phase && <PhaseStrip {...phase} />}

      <div className="playtest-log-dock__filters" role="group" aria-label="Filter the log">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="playtest-log-dock__chip"
            aria-pressed={filter === chip.id}
            onClick={() => choose(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="playtest-log-dock__body" ref={bodyRef} onScroll={handleScroll}>
        {showTable ? (
          table.items.length === 0 ? (
            <p className="playtest-log-dock__empty">No table activity yet.</p>
          ) : (
            <ol className="playtest-log-dock__ticker">
              {table.items.map((it) => (
                <TickerLine key={it.id} item={it} name={table.nameFor(it.seat)} />
              ))}
            </ol>
          )
        ) : groups.length === 0 ? (
          <p className="playtest-log-dock__empty">Nothing logged yet.</p>
        ) : (
          groups.map((group) => (
            <section key={`${group.turn}-${group.entries[0]?.seq ?? 'x'}`}>
              <h3 className="playtest-log-dock__turn">Turn {group.turn}</h3>
              <ol className="playtest-log-dock__entries">
                {group.entries.map((e) => (
                  <li
                    key={e.seq}
                    className={`playtest-log-dock__entry${
                      SYSTEM_KINDS.has(e.kind) ? ' playtest-log-dock__entry--system' : ''
                    }`}
                  >
                    <span className="playtest-log-dock__text">{e.text}</span>
                    {e.ts !== undefined && (
                      <time
                        className="playtest-log-dock__time"
                        dateTime={new Date(e.ts).toISOString()}
                      >
                        {formatTime(e.ts)}
                      </time>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>

      {!stuck && (
        <button
          type="button"
          className="playtest-log-dock__jump"
          onClick={() => {
            setStuck(true);
            const el = bodyRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          ↓ New
        </button>
      )}

      {/* Same mount as PlaytestLogSheet's Table tab: outside the scroller so a
          long feed never pushes the composer out of reach, and self-gating on
          being online and seated. */}
      {showTable && <TableChat idPrefix="log-dock" />}
    </aside>
  );
}

const PHASE_META: Record<GamePhase, { label: string; Icon: typeof Sunrise; flip?: boolean }> = {
  beginning: { label: 'Beginning phase', Icon: Sunrise },
  main1: { label: 'First main phase', Icon: Wand },
  combat: { label: 'Combat phase', Icon: Swords },
  main2: { label: 'Second main phase', Icon: Wand, flip: true },
  end: { label: 'End phase', Icon: Moon },
};

/**
 * Five phase icons, the current one lit. On your own turn each is a button
 * that jumps the clock to that phase (forward or back — a table that
 * skipped combat by mistake can say so); on anyone else's turn they only
 * show where the turn is. Before the clock starts, the strip reads as unlit.
 */
function PhaseStrip({
  current,
  mine,
  onSet,
}: {
  current: GamePhase | undefined;
  mine: boolean;
  onSet(phase: GamePhase): void;
}) {
  return (
    <div
      className="playtest-log-dock__phases"
      role={mine ? 'group' : 'status'}
      aria-label={
        current ? `Phase: ${PHASE_META[current].label}` : 'The phase clock has not started'
      }
    >
      {GAME_PHASES.map((p) => {
        const { label, Icon, flip } = PHASE_META[p];
        const isCurrent = current === p;
        const cls = `playtest-log-dock__phase${isCurrent ? ' is-current' : ''}`;
        const icon = (
          <Icon aria-hidden size={16} style={flip ? { transform: 'scaleX(-1)' } : undefined} />
        );
        return mine ? (
          <button
            key={p}
            type="button"
            className={cls}
            title={label}
            aria-label={label}
            aria-pressed={isCurrent}
            onClick={() => onSet(p)}
          >
            {icon}
          </button>
        ) : (
          <span key={p} className={cls} title={label} aria-label={label} role="img">
            {icon}
          </span>
        );
      })}
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { isOpponentDefeated, type OpponentLife } from '@/lib/playtest';
import { paletteForIndex } from '@/lib/seat-palette';
import { usePressRepeat } from '@/lib/use-press-repeat';
import { cmdDamageKey, type GamePlayer } from '@/lib/game-state';
import { LifeAdjustPanel, type CmdDamageRow, type OnlinePanelData } from './LifeAdjustPanel';
import type { OnlineTable } from '../hooks/use-online-table';

interface Props {
  life: number;
  opponents: OpponentLife[];
  commanderDamageThreshold: number;
  isNarrow: boolean;
  /** Table designations you currently hold — badged on the "You" chip only;
   *  solo play has no per-opponent holder to badge. */
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  /** Your own player-scoped counters; each opponent's live on `opponents[i]`. */
  playerCounters: Record<string, number>;
  onAdjustLife(player: 'self' | number, delta: number): void;
  onAdjustCommanderDamage(opponent: number, delta: number): void;
  onAdjustCounter(player: 'self' | number, kind: string, delta: number): void;
  /** Lets the parent fold the adjust popover into its "any sheet open" gate
   *  (e.g. to suspend keyboard shortcuts while it's up). */
  onOpenChange?(open: boolean): void;
  /** Non-null while seated at an online table — swaps the whole strip to the
   *  table's real seats (see the module doc below). */
  onlineTable: OnlineTable | null;
  /** Opens the shared `OpponentBoardModal` for a seat — "View board" inside
   *  an online opponent's panel. Required whenever `onlineTable` is set. */
  onViewOpponentBoard?(seat: number): void;
  /**
   * `strip` (default) is the one-row chip strip every narrow tier uses.
   * `table` is the ≥1024px corner panel: YOUR life as a display numeral with
   * inline steppers, a chevron that opens the same `LifeAdjustPanel` (minus
   * its life row — the steppers are already on the panel), and the other
   * players demoted to a secondary row of small chips underneath. Same data,
   * same panel, same handlers — only the arrangement differs.
   */
  variant?: 'strip' | 'table';
}

type Selected = 'self' | number | null;

/** One steppable row per OTHER seated player's commander (a partner gets its
 *  own), read from and written to `me`'s own `commanderDamage` bag — the self
 *  panel's "Commander damage" list. Lists every seat unconditionally (even at
 *  0), so the list reads the same all game (EDHPlay's shape). */
function cmdDamageRows(
  me: GamePlayer,
  players: GamePlayer[],
  dispatch: OnlineTable['dispatch']
): CmdDamageRow[] {
  const rows: CmdDamageRow[] = [];
  const step = (fromSeat: number, fromPartner: boolean) => (delta: number) =>
    dispatch({ type: 'cmd-dmg', seat: me.seat, fromSeat, fromPartner, delta, actorSeat: me.seat });
  for (const p of players) {
    if (p.seat === me.seat) continue;
    rows.push({
      key: `${p.seat}`,
      name: p.commander ?? p.name,
      value: me.commanderDamage[cmdDamageKey(p.seat)] ?? 0,
      onAdjust: step(p.seat, false),
    });
    if (p.partner) {
      rows.push({
        key: `${p.seat}#p`,
        name: p.partner,
        value: me.commanderDamage[cmdDamageKey(p.seat, true)] ?? 0,
        onAdjust: step(p.seat, true),
      });
    }
  }
  return rows;
}

/**
 * Compact life/commander-damage strip: you + N players as tappable chips
 * (E138). One row, doesn't displace the battlefield — the adjust UI lives
 * entirely in a popover/sheet opened per chip.
 *
 * Two independent worlds: **solo** (default) renders `opponents`, the
 * virtual playtest opponents dispatched through local reducer actions.
 * **Online** (`onlineTable` set) renders the table's real seats instead —
 * the solo `opponents`/`life`/designation props are ignored entirely, since
 * the table's `GameState` is now the one authoritative source (see
 * `use-online-table.ts`'s `me`/`players` doc comments for why the local
 * `life` prop would otherwise show a second, fake total next to the rail's
 * real one).
 */
export function LifeStrip({
  life,
  opponents,
  commanderDamageThreshold,
  isNarrow,
  monarch,
  initiative,
  citysBlessing,
  playerCounters,
  onAdjustLife,
  onAdjustCommanderDamage,
  onAdjustCounter,
  onOpenChange,
  onlineTable,
  onViewOpponentBoard,
  variant = 'strip',
}: Props) {
  const [selected, setSelected] = useState<Selected>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  function openPanel(target: Selected, e: React.MouseEvent<HTMLButtonElement>) {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setSelected(target);
    onOpenChange?.(true);
  }

  function closePanel() {
    setSelected(null);
    onOpenChange?.(false);
  }

  if (onlineTable) {
    return (
      <OnlineLifeStrip
        onlineTable={onlineTable}
        isNarrow={isNarrow}
        playerCounters={playerCounters}
        onAdjustCounter={onAdjustCounter}
        onViewOpponentBoard={onViewOpponentBoard}
        selected={selected}
        anchorRect={anchorRect}
        openPanel={openPanel}
        closePanel={closePanel}
        variant={variant}
      />
    );
  }

  const opponentLabel = (i: number) => (opponents.length > 1 ? `Opponent ${i + 1}` : 'Opponent');

  /** "poison 3, energy 1" — reused for both the aria-label and the visible
   *  badges so the two can never describe different state. */
  const counterEntries = (bag: Record<string, number> | undefined) =>
    Object.entries(bag ?? {}).filter(([, v]) => v > 0);

  const heldDesignationLabels = [
    monarch && 'Monarch',
    initiative && 'Initiative',
    citysBlessing && "City's Blessing",
  ].filter((label): label is string => Boolean(label));

  const selfCounters = counterEntries(playerCounters);

  const adjustPanel = selected !== null && (
    <LifeAdjustPanel
      variant={isNarrow ? 'sheet' : 'floating'}
      anchorRect={anchorRect}
      title={selected === 'self' ? 'You' : opponentLabel(selected)}
      life={selected === 'self' ? life : opponents[selected].life}
      lifeEditable
      hideLife={selected === 'self' && variant === 'table'}
      // The corner panel is just your own total now, so the virtual opponents
      // are reachable only from here. Their life is the row's own stepper;
      // their name opens their full panel (±5s, their counters).
      opponents={
        selected === 'self'
          ? opponents.map((o, i) => ({
              key: String(i),
              name: opponentLabel(i),
              life: o.life,
              defeated: isOpponentDefeated(o, commanderDamageThreshold),
              onAdjustLife: (delta: number) => onAdjustLife(i, delta),
              onOpen: () => setSelected(i),
            }))
          : undefined
      }
      // Solo tracks the damage YOU dealt each virtual opponent's way; it's one
      // row per opponent in your own panel, the same list online shows.
      cmdDamage={
        selected === 'self'
          ? opponents.map((o, i) => ({
              key: String(i),
              name: opponentLabel(i),
              value: o.commanderDamage,
              onAdjust: (delta: number) => onAdjustCommanderDamage(i, delta),
            }))
          : undefined
      }
      commanderDamageThreshold={commanderDamageThreshold}
      defeated={
        selected !== 'self' && isOpponentDefeated(opponents[selected], commanderDamageThreshold)
      }
      counters={(selected === 'self' ? playerCounters : opponents[selected].counters) ?? {}}
      onClose={closePanel}
      onAdjustCounter={(kind, delta) => onAdjustCounter(selected, kind, delta)}
      onAdjustLife={(delta) => onAdjustLife(selected, delta)}
    />
  );

  if (variant === 'table') {
    return (
      <TableLifePanel
        life={life}
        onAdjustLife={(delta) => onAdjustLife('self', delta)}
        onOpenSelf={(e) => openPanel('self', e)}
        designations={heldDesignationLabels}
        counters={selfCounters}
      >
        {adjustPanel}
      </TableLifePanel>
    );
  }

  return (
    <div className="playtest-life-strip" role="group" aria-label="Life totals">
      <button
        type="button"
        className="playtest-life-chip"
        onClick={(e) => openPanel('self', e)}
        aria-label={`You: ${life} life${
          heldDesignationLabels.length > 0 ? `, ${heldDesignationLabels.join(', ')}` : ''
        }${selfCounters.length > 0 ? `, ${selfCounters.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`}
      >
        <span className="playtest-life-chip__label">You</span>
        {heldDesignationLabels.length > 0 && (
          <span className="playtest-life-chip__designations" aria-hidden>
            {monarch && <span className="playtest-designation-badge">👑</span>}
            {initiative && <span className="playtest-designation-badge">🧭</span>}
            {citysBlessing && <span className="playtest-designation-badge">🏙️</span>}
          </span>
        )}
        <span className="playtest-life-chip__life">{life}</span>
        {selfCounters.length > 0 && (
          <span className="playtest-life-chip__counters" aria-hidden>
            {selfCounters.map(([k, v]) => (
              <span key={k} className="playtest-life-chip__counter" title={k}>
                {k.slice(0, 3)}:{v}
              </span>
            ))}
          </span>
        )}
      </button>
      {opponents.map((o, i) => {
        const defeated = isOpponentDefeated(o, commanderDamageThreshold);
        const oppCounters = counterEntries(o.counters);
        return (
          <button
            key={i}
            type="button"
            className={`playtest-life-chip playtest-life-chip--opponent${
              defeated ? ' is-defeated' : ''
            }`}
            onClick={(e) => openPanel(i, e)}
            aria-label={`${opponentLabel(i)}: ${o.life} life${
              o.commanderDamage > 0 ? `, ${o.commanderDamage} commander damage` : ''
            }${
              oppCounters.length > 0
                ? `, ${oppCounters.map(([k, v]) => `${k} ${v}`).join(', ')}`
                : ''
            }${defeated ? ', defeated' : ''}`}
          >
            <span className="playtest-life-chip__label">
              {opponents.length > 1 ? `Opp ${i + 1}` : 'Opponent'}
            </span>
            <span className="playtest-life-chip__life">{o.life}</span>
            {o.commanderDamage > 0 && (
              <span className="playtest-life-chip__cmdr" aria-hidden>
                {o.commanderDamage}
              </span>
            )}
            {oppCounters.length > 0 && (
              <span className="playtest-life-chip__counters" aria-hidden>
                {oppCounters.map(([k, v]) => (
                  <span key={k} className="playtest-life-chip__counter" title={k}>
                    {k.slice(0, 3)}:{v}
                  </span>
                ))}
              </span>
            )}
            {defeated && (
              <span className="playtest-life-chip__skull" aria-hidden>
                ☠
              </span>
            )}
          </button>
        );
      })}

      {adjustPanel}
    </div>
  );
}

/** The online-table half of `LifeStrip` — real seats, in seat order, off the
 *  table's authoritative `GameState`. Split out rather than branched inline
 *  throughout the solo JSX above so neither world has to read past the
 *  other's markup. */
function OnlineLifeStrip({
  onlineTable,
  isNarrow,
  playerCounters,
  onAdjustCounter,
  onViewOpponentBoard,
  selected,
  anchorRect,
  openPanel,
  closePanel,
  variant,
}: {
  onlineTable: OnlineTable;
  isNarrow: boolean;
  playerCounters: Record<string, number>;
  onAdjustCounter(player: 'self' | number, kind: string, delta: number): void;
  onViewOpponentBoard?(seat: number): void;
  selected: Selected;
  anchorRect: DOMRect | null;
  openPanel(target: Selected, e: React.MouseEvent<HTMLButtonElement>): void;
  closePanel(): void;
  variant: 'strip' | 'table';
}) {
  const {
    me,
    players,
    mySeat,
    activeSeat,
    designations,
    poisonEnabled,
    commanderDamageEnabled,
    dispatch,
  } = onlineTable;

  const selectedPlayer =
    typeof selected === 'number' ? players.find((p) => p.seat === selected) : null;

  let panel: React.ReactNode = null;
  if (selected === 'self') {
    const online: OnlinePanelData = {
      kind: 'self',
      poison: poisonEnabled
        ? {
            value: me.poison,
            onAdjust: (delta) =>
              dispatch({ type: 'poison', seat: mySeat, delta, actorSeat: mySeat }),
          }
        : undefined,
    };
    panel = (
      <LifeAdjustPanel
        variant={isNarrow ? 'sheet' : 'floating'}
        anchorRect={anchorRect}
        title="You"
        life={me.life}
        lifeEditable
        hideLife={variant === 'table'}
        cmdDamage={commanderDamageEnabled ? cmdDamageRows(me, players, dispatch) : undefined}
        commanderDamageThreshold={21}
        defeated={false}
        counters={playerCounters}
        countersLabel="Counters (this device)"
        onClose={closePanel}
        onAdjustLife={(delta) => dispatch({ type: 'life', seat: mySeat, delta, actorSeat: mySeat })}
        onAdjustCounter={(kind, delta) => onAdjustCounter('self', kind, delta)}
        online={online}
      />
    );
  } else if (selectedPlayer) {
    const online: OnlinePanelData = {
      kind: 'opponent',
      name: selectedPlayer.name,
      onViewBoard: () => {
        closePanel();
        onViewOpponentBoard?.(selectedPlayer.seat);
      },
    };
    panel = (
      <LifeAdjustPanel
        variant={isNarrow ? 'sheet' : 'floating'}
        anchorRect={anchorRect}
        title={selectedPlayer.name}
        life={selectedPlayer.life}
        lifeEditable={false}
        commanderDamageThreshold={21}
        defeated={false}
        counters={{}}
        onClose={closePanel}
        onAdjustLife={() => {}}
        onAdjustCounter={() => {}}
        online={online}
      />
    );
  }

  if (variant === 'table') {
    const held = [
      designations.monarch === mySeat && 'Monarch',
      designations.initiative === mySeat && 'Initiative',
    ].filter((v): v is string => Boolean(v));
    // No `opponents` list online: those seats are real quadrants on the felt
    // (OpponentRail / OpponentQuadrant), so duplicating them in the popover
    // would be a second place to read the same number.
    return (
      <TableLifePanel
        life={me.life}
        onAdjustLife={(delta) => dispatch({ type: 'life', seat: mySeat, delta, actorSeat: mySeat })}
        onOpenSelf={(e) => openPanel('self', e)}
        designations={held}
        counters={Object.entries(playerCounters).filter(([, v]) => v > 0)}
      >
        {selected !== null && panel}
      </TableLifePanel>
    );
  }

  return (
    <div className="playtest-life-strip" role="group" aria-label="Life totals">
      {players.map((p) => (
        <SeatChip
          key={p.seat}
          player={p}
          isMe={p.seat === mySeat}
          isActive={p.seat === activeSeat}
          poisonEnabled={poisonEnabled}
          designations={designations}
          onOpen={(e) => openPanel(p.seat === mySeat ? 'self' : p.seat, e)}
        />
      ))}
      {selected !== null && panel}
    </div>
  );
}

/** A ±1 life step that repeats while held — same `usePressRepeat` contract as
 *  ManaPool's and the adjust panel's own steppers. Its own component because
 *  the hook can't be called conditionally. */
function LifeStep({
  label,
  onAdjust,
  children,
}: {
  label: string;
  onAdjust(): void;
  children: ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" className="playtest-life-table__step" aria-label={label} {...press}>
      {children}
    </button>
  );
}

/**
 * A transient "+5" / "−3" beside your total while you are taking damage.
 *
 * EDHPlay shows the running change as you click, and it answers the question
 * the numeral cannot: you know you are on 34, but not whether that was six
 * off a Blightning or one off a fetch. It accumulates every step within
 * `LIFE_DELTA_IDLE_MS` of the last one, then clears — so a burst of clicks is
 * one number, and a change you have finished making stops shouting.
 *
 * `aria-hidden`: the total's own button already announces the new value, and
 * a live delta would make a screen reader read every intermediate step of a
 * press-and-hold.
 */
const LIFE_DELTA_IDLE_MS = 1400;

function useLifeDelta(life: number): number {
  const [delta, setDelta] = useState(0);
  const prev = useRef(life);
  useEffect(() => {
    const change = life - prev.current;
    prev.current = life;
    if (change === 0) return;
    setDelta((d) => d + change);
    const t = window.setTimeout(() => setDelta(0), LIFE_DELTA_IDLE_MS);
    return () => window.clearTimeout(t);
  }, [life]);
  // A reset back to starting life (RESET) lands as one big jump; nothing to
  // special-case, but a delta of 0 must never render as "+0".
  return delta;
}

/**
 * The ≥1024px corner panel, and deliberately almost nothing: − 40 + on one
 * line, with a chevron under it. That is the whole resting state.
 *
 * It used to be a headline numeral between two 44px boxes, then a row of
 * opponent chips, then the mana row — a block of chrome sitting over the felt
 * all game to show one number that changes a dozen times. Everything else
 * moved behind the chevron (opponents, commander damage, counters) or out to
 * its own corner (mana). What stays on the felt is what you look at between
 * every spell; what you touch a few times a game is one click away.
 *
 * The badges are the exception, and only when they are non-zero: a poison
 * count or the Monarch is a thing you must not have to open a panel to
 * notice.
 */
function TableLifePanel({
  life,
  onAdjustLife,
  onOpenSelf,
  designations,
  counters,
  children,
}: {
  life: number;
  onAdjustLife(delta: number): void;
  onOpenSelf(e: React.MouseEvent<HTMLButtonElement>): void;
  designations: string[];
  counters: [string, number][];
  children?: ReactNode;
}) {
  const delta = useLifeDelta(life);
  return (
    <div className="playtest-life-table" role="group" aria-label="Life totals">
      <div className="playtest-life-table__row">
        <LifeStep label="Lose 1 life" onAdjust={() => onAdjustLife(-1)}>
          −
        </LifeStep>
        <button
          type="button"
          className="playtest-life-table__total"
          onClick={onOpenSelf}
          aria-haspopup="dialog"
          aria-label={`You: ${life} life. Open life details`}
        >
          {life}
        </button>
        <LifeStep label="Gain 1 life" onAdjust={() => onAdjustLife(1)}>
          +
        </LifeStep>
        {delta !== 0 && (
          <span
            className={`playtest-life-table__delta${delta > 0 ? ' is-gain' : ' is-loss'}`}
            aria-hidden
          >
            {/* A real minus sign, matching the stepper beside it — a raw
                negative number renders an ASCII hyphen. */}
            {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
          </span>
        )}
      </div>
      {(designations.length > 0 || counters.length > 0) && (
        <div className="playtest-life-table__badges">
          {designations.map((d) => (
            <span key={d} className="playtest-life-table__badge">
              {d}
            </span>
          ))}
          {counters.map(([k, v]) => (
            <span key={k} className="playtest-life-table__badge" title={k}>
              {k} {v}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        className="playtest-life-table__details"
        onClick={onOpenSelf}
        aria-haspopup="dialog"
        aria-label="Opponents, commander damage and counters"
      >
        <ChevronDown aria-hidden width={14} height={14} />
      </button>
      {children}
    </div>
  );
}

function SeatChip({
  player,
  isMe,
  isActive,
  poisonEnabled,
  designations,
  onOpen,
}: {
  player: GamePlayer;
  isMe: boolean;
  isActive: boolean;
  poisonEnabled: boolean;
  designations: OnlineTable['designations'];
  onOpen(e: React.MouseEvent<HTMLButtonElement>): void;
}) {
  const palette = paletteForIndex(player.seat);
  const isDead = player.eliminated || player.life <= 0;
  const held = [
    designations.monarch === player.seat && { icon: '👑', label: 'Monarch' },
    designations.initiative === player.seat && { icon: '🧭', label: 'Initiative' },
  ].filter((v): v is { icon: string; label: string } => Boolean(v));

  const ariaLabel = [
    isMe ? `You (${player.name})` : player.name,
    `${player.life} life`,
    isActive && "this player's turn",
    poisonEnabled && player.poison > 0 && `${player.poison} poison`,
    held.length > 0 && `holds ${held.map((h) => h.label).join(', ')}`,
    isDead && 'defeated',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={`playtest-life-chip playtest-life-chip--seat${isDead ? ' is-defeated' : ''}${
        isActive ? ' is-active-turn' : ''
      }`}
      style={{ ['--opp-base' as never]: palette.base, ['--opp-edge' as never]: palette.edge }}
      onClick={onOpen}
      title={isMe ? player.name : undefined}
      aria-label={ariaLabel}
    >
      <span className="playtest-life-chip__dot" aria-hidden />
      <span className="playtest-life-chip__label">{isMe ? 'You' : player.name}</span>
      {held.length > 0 && (
        <span className="playtest-life-chip__designations" aria-hidden>
          {held.map((h) => (
            <span key={h.label} className="playtest-designation-badge">
              {h.icon}
            </span>
          ))}
        </span>
      )}
      <span className="playtest-life-chip__life">{player.life}</span>
      {poisonEnabled && player.poison > 0 && (
        <span className="playtest-life-chip__poison" aria-hidden>
          ☠ {player.poison}
        </span>
      )}
      {isDead && (
        <span className="playtest-life-chip__skull" aria-hidden>
          ☠
        </span>
      )}
    </button>
  );
}

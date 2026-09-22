import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Radiation, Skull, Ticket, Zap, type LucideIcon } from 'lucide-react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';
import { usePressRepeat } from '@/lib/use-press-repeat';

/** One commander-damage row in the self panel's list — solo: damage YOU
 *  dealt to that virtual opponent; online: damage taken FROM that seat's
 *  commander (one row per commander, so a partner gets its own). `key`
 *  disambiguates a partner's row from the primary's. */
export interface CmdDamageRow {
  key: string;
  name: string;
  value: number;
  onAdjust(delta: number): void;
}

/** One opponent seat in the self panel's list — an "Opponents" section that
 *  only a real game gets. Goldfishing has no opponents worth a section: you
 *  are testing a deck against nobody, so the popover there is your counters
 *  and nothing else (EDHPlay's shape).
 *
 *  `onAdjustLife` is omitted where their life is not yours to change — an
 *  online seat owns its own total — and the row is then a read-only number
 *  next to the name, which stays a button into their full panel. */
export interface OpponentRow {
  key: string;
  name: string;
  life: number;
  defeated: boolean;
  onAdjustLife?(delta: number): void;
  /** Opens that opponent's own panel — their counters, and life in ±5s. */
  onOpen(): void;
}

/** Online-only panel content — absent in solo mode. `self` may carry the
 *  table's authoritative poison stepper, which takes the Poison row's place
 *  in the counter list; `opponent` gets a read-only life note and a "View
 *  board" escape hatch into the full board inspector. Commander damage is
 *  not here: it rides the shared `cmdDamage` rows in both worlds. */
export type OnlinePanelData =
  | {
      kind: 'self';
      poison?: { value: number; onAdjust(delta: number): void };
    }
  | {
      kind: 'opponent';
      name: string;
      onViewBoard(): void;
    };

interface Props {
  variant: 'floating' | 'sheet';
  /** Trigger chip's rect (floating variant only) — anchors the popover under it. */
  anchorRect: DOMRect | null;
  title: string;
  life: number;
  /** False renders life as a plain read-only number — an online opponent's
   *  seat, which only they may change (see `online.kind === 'opponent'`). */
  lifeEditable: boolean;
  /** True leaves life out of the panel entirely — the wide table's corner
   *  panel already has the numeral between two steppers, so the popover under
   *  its chevron is counters and commander damage only (EDHPlay's shape). */
  hideLife?: boolean;
  /** True drops the floating panel's heading. The popover hangs off the
   *  chevron of the very panel showing your total, so "You" above it names
   *  what you are already looking at. `aria-label` still carries it. */
  hideTitle?: boolean;
  /** Opponent seats, self panel only — see `OpponentRow`. */
  opponents?: OpponentRow[];
  /** Commander damage, one row per commander, self panel only. Solo passes a
   *  row per virtual opponent; online a row per other seat's commander(s). */
  cmdDamage?: CmdDamageRow[];
  commanderDamageThreshold: number;
  defeated: boolean;
  /** Player-scoped counters (poison/energy/experience/…) for this player. */
  counters: Record<string, number>;
  /** "Counters" by default; online-self overrides to "Counters (this
   *  device)" — this section is local-only bookkeeping even while seated. */
  countersLabel?: string;
  onClose(): void;
  onAdjustLife(delta: number): void;
  onAdjustCounter(kind: string, delta: number): void;
  /** Set while seated at an online table — see `OnlinePanelData`. */
  online?: OnlinePanelData;
}

const MARGIN = 8;
const STEPS = [-5, -1, 1, 5] as const;
/** The player counters modern Magic actually puts on a player, listed even at
 *  zero so the panel reads the same every game (EDHPlay's list). Poison is the
 *  one alternate kill condition; the rest are what a deck routinely tracks.
 *  Anything else gets added by name. */
const PLAYER_COUNTERS: { kind: string; label: string; Icon: LucideIcon }[] = [
  { kind: 'poison', label: 'Poison', Icon: Skull },
  { kind: 'energy', label: 'Energy', Icon: Zap },
  { kind: 'experience', label: 'Experience', Icon: Clock },
  { kind: 'rad', label: 'Rad', Icon: Radiation },
  { kind: 'tickets', label: 'Tickets', Icon: Ticket },
];
const PRESET_KINDS = PLAYER_COUNTERS.map((c) => c.kind);
const MAX_COUNTER_NAME = 20;
const POISON_LETHAL = 10;

/** A ± step that repeats while held — see `usePressRepeat`. Split into its own
 *  component because the hook can't be called inside a `.map`. */
function StepButton({
  className = 'playtest-life-panel__step',
  label,
  onAdjust,
  children,
}: {
  className?: string;
  label: string;
  onAdjust(): void;
  children: React.ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" className={className} aria-label={label} {...press}>
      {children}
    </button>
  );
}

function Stepper({
  label,
  value,
  onAdjust,
}: {
  label: string;
  value: number;
  onAdjust(delta: number): void;
}) {
  return (
    <div className="playtest-life-panel__stepper">
      <span className="playtest-life-panel__stepper-label">{label}</span>
      <div className="playtest-life-panel__stepper-row">
        {STEPS.slice(0, 2).map((d) => (
          <StepButton key={d} label={`${label} ${d}`} onAdjust={() => onAdjust(d)}>
            {d}
          </StepButton>
        ))}
        <span className="playtest-life-panel__value" aria-live="polite">
          {value}
        </span>
        {STEPS.slice(2).map((d) => (
          <StepButton key={d} label={`${label} +${d}`} onAdjust={() => onAdjust(d)}>
            +{d}
          </StepButton>
        ))}
      </div>
    </div>
  );
}

/** A ±1 stepper — every counter and commander-damage row. Coarser ±5/±1 (the
 *  `Stepper` above) fits a life total's range; a single hit of commander
 *  damage or a poison counter moves by ones. */
function PlusMinusStepper({
  label,
  value,
  lethal,
  onAdjust,
}: {
  label: string;
  value: number;
  lethal?: boolean;
  onAdjust(delta: number): void;
}) {
  return (
    <div className="playtest-life-panel__pm-row">
      <span
        className={`playtest-life-panel__value${lethal ? ' is-lethal' : ''}`}
        aria-live="polite"
      >
        {value}
      </span>
      <StepButton
        className="playtest-life-panel__pm-step"
        label={`${label} -1`}
        onAdjust={() => onAdjust(-1)}
      >
        −
      </StepButton>
      <StepButton
        className="playtest-life-panel__pm-step"
        label={`${label} +1`}
        onAdjust={() => onAdjust(1)}
      >
        +
      </StepButton>
    </div>
  );
}

/** One commander-damage row — see `CmdDamageRow`'s doc. */
function CmdRow({ name, value, onAdjust, lethalAt }: CmdDamageRow & { lethalAt: number }) {
  const lethal = value >= lethalAt;
  const toLethal = value > 0 && !lethal ? lethalAt - value : null;
  return (
    <div className={`playtest-life-panel__cmd-row${lethal ? ' is-lethal' : ''}`}>
      <span className="playtest-life-panel__cmd-row-name" title={name}>
        {name}
      </span>
      <PlusMinusStepper
        label={`Commander damage from ${name}`}
        value={value}
        lethal={lethal}
        onAdjust={onAdjust}
      />
      {toLethal !== null && (
        <span className="playtest-life-panel__cmdr-note">{toLethal} to lethal</span>
      )}
      {lethal && <span className="playtest-life-panel__cmdr-note">Lethal commander damage</span>}
    </div>
  );
}

/**
 * Life/commander-damage adjustment popover for one player (LifeStrip chip).
 * Mirrors `CardContextMenu`'s dual floating/sheet chrome: a cursor-anchored
 * popover on wide viewports, the shared card-picker bottom sheet on narrow
 * ones (both variant-agnostic content).
 *
 * The body is one list, in the order a table reads them: life (unless the
 * caller already shows it), the opponent seats, commander damage one row per
 * commander, then the fixed player counters as icon rows. Commander damage
 * sits ABOVE the counters on purpose — it is the other way a game ends, so it
 * belongs with the opponents it comes from rather than below poison.
 *
 * Every section above the counters belongs to a REAL GAME. Goldfishing passes
 * none of them, and the popover is the counter list alone — no title, no
 * heading, no dividers. See `OpponentRow`.
 */
export function LifeAdjustPanel({
  variant,
  anchorRect,
  title,
  life,
  lifeEditable,
  hideLife = false,
  hideTitle = false,
  opponents,
  cmdDamage,
  commanderDamageThreshold,
  defeated,
  counters,
  countersLabel,
  onClose,
  onAdjustLife,
  onAdjustCounter,
  online,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const [counterText, setCounterText] = useState('');
  const [addingCounter, setAddingCounter] = useState(false);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');

  useLockBodyScroll();
  useEscapeKey(variant === 'sheet' ? beginClose : onClose);

  useEffect(() => {
    if (variant !== 'floating') return;
    const el = panelRef.current;
    if (!el || !anchorRect) return;
    const rect = el.getBoundingClientRect();
    const safe = getSafeViewport();
    const left = Math.max(MARGIN, Math.min(anchorRect.left, safe.right - rect.width - MARGIN));
    const top = Math.max(
      MARGIN,
      Math.min(anchorRect.bottom + 6, safe.bottom - rect.height - MARGIN)
    );
    setClamped({ left, top });
  }, [anchorRect, variant, addingCounter]);

  function submitCounter() {
    const kind = counterText.trim().slice(0, MAX_COUNTER_NAME);
    if (!kind) return;
    onAdjustCounter(kind, 1);
    setCounterText('');
    setAddingCounter(false);
  }

  // The fixed list, then any custom kind already on this player, so a counter
  // added by name stays adjustable afterwards. Online-self's Poison row is the
  // table's authoritative one ("one fact, one place"), never the local bag's.
  const onlinePoison = online?.kind === 'self' ? online.poison : undefined;
  const customKinds = Object.keys(counters).filter((k) => !PRESET_KINDS.includes(k));

  // Goldfishing leaves only the counters, and a lone section heading over a
  // lone section is a label for the panel, not for a group inside it — so the
  // heading (and its divider) drop out and the list is the whole popover.
  const countersAreTheWholePanel =
    hideLife &&
    !online &&
    (opponents?.length ?? 0) === 0 &&
    (cmdDamage?.length ?? 0) === 0 &&
    !defeated;

  const body = (
    <>
      {!hideLife &&
        (lifeEditable ? (
          <Stepper label="Life" value={life} onAdjust={onAdjustLife} />
        ) : (
          <div className="playtest-life-panel__stepper">
            <span className="playtest-life-panel__stepper-label">Life</span>
            <span
              className="playtest-life-panel__value playtest-life-panel__value--readonly"
              aria-live="polite"
            >
              {life}
            </span>
          </div>
        ))}
      {online?.kind === 'opponent' && (
        <p className="playtest-life-panel__readonly-note">
          Only {online.name} can change their life.
        </p>
      )}
      {online?.kind === 'opponent' && (
        <button
          type="button"
          className="btn playtest-life-panel__view-board"
          onClick={online.onViewBoard}
        >
          View board
        </button>
      )}
      {opponents && opponents.length > 0 && (
        <div className="playtest-life-panel__opponents">
          <div className="playtest-life-panel__counters-heading">Opponents</div>
          {opponents.map((o) => (
            <div
              key={o.key}
              className={`playtest-life-panel__cmd-row${o.defeated ? ' is-lethal' : ''}`}
            >
              {/* The name opens that opponent's own panel, where life moves in
                  ±5s and their counters live. The row's own stepper is the
                  quick hit, so the common case never costs a second panel. */}
              <button
                type="button"
                className="playtest-life-panel__opponent-name"
                onClick={o.onOpen}
                aria-haspopup="dialog"
                aria-label={`${o.name}: ${o.life} life${o.defeated ? ', defeated' : ''}. Open their panel`}
              >
                {o.name}
              </button>
              {o.onAdjustLife ? (
                <PlusMinusStepper
                  label={`${o.name} life`}
                  value={o.life}
                  onAdjust={o.onAdjustLife}
                />
              ) : (
                <span
                  className="playtest-life-panel__value playtest-life-panel__value--readonly"
                  aria-hidden
                >
                  {o.life}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {cmdDamage && cmdDamage.length > 0 && (
        <div className="playtest-life-panel__cmd-list">
          <div className="playtest-life-panel__counters-heading">Commander damage</div>
          {cmdDamage.map((row) => (
            <CmdRow
              key={row.key}
              name={row.name}
              value={row.value}
              onAdjust={row.onAdjust}
              lethalAt={commanderDamageThreshold}
            />
          ))}
        </div>
      )}
      {(!online || online.kind === 'self') && (
        <div className="playtest-life-panel__counters">
          {!countersAreTheWholePanel && (
            <div className="playtest-life-panel__counters-heading">
              {countersLabel ?? 'Counters'}
            </div>
          )}
          {PLAYER_COUNTERS.map(({ kind, label, Icon }) => {
            const authoritative = kind === 'poison' ? onlinePoison : undefined;
            const value = authoritative?.value ?? counters[kind] ?? 0;
            return (
              <div key={kind} className="playtest-life-panel__counter">
                <Icon className="playtest-life-panel__counter-icon" aria-hidden />
                <span className="playtest-life-panel__counter-label">{label}</span>
                <PlusMinusStepper
                  label={label}
                  value={value}
                  lethal={kind === 'poison' && value >= POISON_LETHAL}
                  onAdjust={authoritative?.onAdjust ?? ((delta) => onAdjustCounter(kind, delta))}
                />
              </div>
            );
          })}
          {customKinds.map((kind) => (
            <div key={kind} className="playtest-life-panel__counter">
              <span className="playtest-life-panel__counter-icon" aria-hidden />
              <span className="playtest-life-panel__counter-label">{kind}</span>
              <PlusMinusStepper
                label={kind}
                value={counters[kind] ?? 0}
                onAdjust={(delta) => onAdjustCounter(kind, delta)}
              />
            </div>
          ))}
          {addingCounter ? (
            <div className="playtest-life-panel__counter-add">
              <input
                type="text"
                value={counterText}
                onChange={(e) => setCounterText(e.target.value)}
                placeholder="Counter name"
                maxLength={MAX_COUNTER_NAME}
                aria-label="Counter name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCounter();
                }}
              />
              <button
                type="button"
                disabled={!counterText.trim()}
                onClick={submitCounter}
                aria-label="Add counter"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="playtest-life-panel__counter-more"
              onClick={() => setAddingCounter(true)}
            >
              Another counter
            </button>
          )}
        </div>
      )}
      {defeated && (
        <p className="playtest-life-panel__defeated">Defeated. Heal to bring them back.</p>
      )}
    </>
  );

  if (variant === 'sheet') {
    return (
      <div className="card-picker-root">
        {/* The backdrop fully covers the root (both `inset: 0`), so it — not
            root — is what a "click outside the sheet" actually lands on. */}
        <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
        <div
          className={`card-picker-sheet playtest-life-panel-sheet${isClosing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="card-picker-handle" aria-hidden />
          <div className="card-picker-header">
            <h2 className="card-picker-title">{title}</h2>
          </div>
          <div className="playtest-life-panel">{body}</div>
          <div className="card-picker-footer">
            <button type="button" className="btn" onClick={() => beginClose()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Portaled to <body>, and that is load-bearing rather than tidiness. This
  // panel is `position: fixed` and positioned from viewport coordinates, but
  // it renders as a child of `.playtest-life-table`, which carries
  // `backdrop-filter: blur(6px)` — and a backdrop-filter makes an element a
  // containing block for fixed descendants, exactly as a transform does. Left
  // in place, the viewport coordinates were applied relative to that little
  // chip instead of the screen.
  //
  // On the local board the chip sits at (12, 12), so the error was 13px and
  // nobody saw it. At an online table's 2x2 grid the chip sits in a quadrant
  // ~530px down, so the panel landed off the bottom of the screen and the
  // chevron appeared to do nothing. Measured in a browser before and after.
  return createPortal(
    <>
      <div className="playtest-ctx__backdrop" role="presentation" onClick={onClose} />
      <div
        ref={panelRef}
        className="playtest-life-panel-floating"
        style={{
          left: clamped?.left ?? anchorRect?.left ?? 0,
          top: clamped?.top ?? anchorRect?.bottom ?? 0,
          visibility: clamped ? 'visible' : 'hidden',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {!hideTitle && <div className="playtest-life-panel__title">{title}</div>}
        <div className="playtest-life-panel">{body}</div>
      </div>
    </>,
    document.body
  );
}

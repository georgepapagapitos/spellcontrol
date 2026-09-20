import { useState } from 'react';
import { usePressRepeat } from '@/lib/use-press-repeat';
import type { Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, destinationKey } from '../lib/zones';
import { CtxMenuShell } from './CtxMenuShell';

interface Props {
  x: number;
  y: number;
  cardName: string;
  stickers: string[];
  /** Live counter tallies on this card — drives the value shown beside each
   *  ± row, and surfaces custom counter kinds that aren't in COUNTER_KINDS. */
  counters: Record<string, number>;
  /** Other battlefield permanents this card can be attached to. */
  attachTargets: Array<{ id: string; name: string }>;
  /** Name of the permanent this card is currently attached to, if any. */
  attachedToName?: string;
  /** `null` detaches. */
  onAttach(targetId: string | null): void;
  /** Current commander tax (already ×2, e.g. 4 for "Tax: +4"); 0/undefined hides the line. */
  tax?: number;
  /** Only true two-faced cards (transform/MDFC) offer Transform. */
  canTransform?: boolean;
  /** Current tapped / face-down state — the menu names the action that
   *  changes it ("Untap", "Turn face up") rather than a "Tap / Untap"
   *  toggle the player has to resolve against the board. */
  tapped?: boolean;
  faceDown?: boolean;
  /** Current phased-out state — purely a "doesn't interact right now"
   *  reminder flag, no rules enforcement. See `BattlefieldCard.phased`. */
  phased?: boolean;
  variant?: 'floating' | 'sheet';
  onClose(): void;
  /** Opens the shared CardPreview (B6-07). Omitted (no menu item) when this
   *  card has no resolvable ScryfallCard to preview. */
  onPreview?(): void;
  onTap(): void;
  onAddCounter(kind: string): void;
  onRemoveCounter(kind: string): void;
  onAddSticker(text: string): void;
  onRemoveSticker(index: number): void;
  onFlip(): void;
  onTransform(): void;
  onTogglePhased(): void;
  /** Current power/toughness modifier, if any — shown as the running total
   *  beside the ± steps so the menu never asks the player to remember what
   *  they have already pumped. */
  pt?: { power: number; toughness: number };
  onAdjustPT(power: number, toughness: number): void;
  /** Put this card on the stack, or put a copy of it there. */
  onPutOnStack(copy: boolean): void;
  /** Token-copy this card. When a multi-card selection is active and includes
   *  this card, the whole selection is copied — `selectionSize` says so. */
  onDuplicate(): void;
  /** How many cards `onDuplicate` will copy (1 unless a selection is live). */
  selectionSize?: number;
  onMoveTo(zone: Zone, toIndex?: number): void;
}

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
const MAX_COUNTER_NAME = 20;

/** A ± counter step that repeats while held. Own component because the hook
 *  can't be called inside the `.map` below. */
function CounterStep({
  label,
  onAdjust,
  children,
}: {
  label: string;
  onAdjust(): void;
  children: React.ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" aria-label={label} {...press}>
      {children}
    </button>
  );
}

export function CardContextMenu({
  x,
  y,
  cardName,
  stickers,
  counters,
  attachTargets,
  attachedToName,
  onAttach,
  tax,
  canTransform = false,
  tapped = false,
  faceDown = false,
  phased = false,
  variant = 'floating',
  onClose,
  onPreview,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onAddSticker,
  onRemoveSticker,
  onFlip,
  onTransform,
  onTogglePhased,
  pt,
  onAdjustPT,
  onPutOnStack,
  onDuplicate,
  selectionSize = 1,
  onMoveTo,
}: Props) {
  const [stickerText, setStickerText] = useState('');
  const [counterText, setCounterText] = useState('');

  function submitSticker() {
    const text = stickerText.trim();
    if (!text) return;
    onAddSticker(text);
    setStickerText('');
  }

  function submitCounter() {
    const kind = counterText.trim().slice(0, MAX_COUNTER_NAME);
    if (!kind) return;
    onAddCounter(kind);
    setCounterText('');
  }

  // The four presets plus whatever custom kinds are already on the card, so a
  // counter added by name stays adjustable (and removable) afterwards rather
  // than being visible only on the card face.
  const counterKinds = [
    ...COUNTER_KINDS,
    ...Object.keys(counters).filter((k) => !COUNTER_KINDS.includes(k)),
  ];

  // Action list — identical markup in both variants; only the surrounding
  // chrome differs (a cursor-anchored popover vs. the shared bottom sheet).
  const items = (
    <>
      {Boolean(tax) && <div className="playtest-ctx-tax">Tax: +{tax}</div>}
      {onPreview && (
        <button type="button" className="playtest-ctx-action" onClick={onPreview}>
          Preview card
        </button>
      )}
      <button type="button" className="playtest-ctx-action" onClick={onTap}>
        {tapped ? 'Untap' : 'Tap'}
      </button>
      <button type="button" className="playtest-ctx-action" onClick={onFlip}>
        {faceDown ? 'Turn face up' : 'Turn face down'}
      </button>
      <button
        type="button"
        className="playtest-ctx-action"
        onClick={onTogglePhased}
        aria-pressed={phased}
      >
        {phased ? 'Phase in' : 'Phase out'}
      </button>
      <button type="button" className="playtest-ctx-action" onClick={onDuplicate}>
        {selectionSize > 1 ? `Duplicate ${selectionSize} selected` : 'Duplicate'}
      </button>
      <button type="button" className="playtest-ctx-action" onClick={() => onPutOnStack(false)}>
        Put on the stack
      </button>
      <button type="button" className="playtest-ctx-action" onClick={() => onPutOnStack(true)}>
        Copy onto the stack
      </button>
      {canTransform && (
        <button type="button" className="playtest-ctx-action" onClick={onTransform}>
          Transform
        </button>
      )}
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Power / toughness</div>
        {/* A running modifier, not an absolute — the card face adds it to the
            printed body. Kept apart from the +1/+1 counters below because a
            pump that wears off at end of turn and a counter that stays are
            different things at a real table. */}
        {(
          [
            ['Power', pt?.power ?? 0, (d: number) => onAdjustPT(d, 0)],
            ['Toughness', pt?.toughness ?? 0, (d: number) => onAdjustPT(0, d)],
          ] as const
        ).map(([label, value, adjust]) => (
          <div key={label} className="playtest-ctx-counter">
            <span>{label}</span>
            <span className="playtest-ctx-counter__value" aria-hidden>
              {value >= 0 ? `+${value}` : value}
            </span>
            <CounterStep
              label={`${label} down, currently ${value >= 0 ? `+${value}` : value}`}
              onAdjust={() => adjust(-1)}
            >
              −
            </CounterStep>
            <CounterStep
              label={`${label} up, currently ${value >= 0 ? `+${value}` : value}`}
              onAdjust={() => adjust(1)}
            >
              +
            </CounterStep>
          </div>
        ))}
      </div>
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Counters</div>
        {counterKinds.map((k) => (
          <div key={k} className="playtest-ctx-counter">
            <span>{k}</span>
            <span className="playtest-ctx-counter__value" aria-hidden>
              {counters[k] ?? 0}
            </span>
            <CounterStep
              label={`Remove ${k}, currently ${counters[k] ?? 0}`}
              onAdjust={() => onRemoveCounter(k)}
            >
              −
            </CounterStep>
            <CounterStep
              label={`Add ${k}, currently ${counters[k] ?? 0}`}
              onAdjust={() => onAddCounter(k)}
            >
              +
            </CounterStep>
          </div>
        ))}
        {/* The reducer already accepts any counter name — this input is the
            only thing that was missing for saga chapters, ascend, fade, etc. */}
        <div className="playtest-ctx-counter-add">
          <input
            type="text"
            value={counterText}
            onChange={(e) => setCounterText(e.target.value)}
            placeholder="chapter"
            maxLength={MAX_COUNTER_NAME}
            aria-label="Counter name"
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
      </div>
      {(attachTargets.length > 0 || attachedToName) && (
        <div className="playtest-ctx-group">
          <div className="playtest-ctx-heading">Attached to</div>
          {attachedToName ? (
            <div className="playtest-ctx-attached">
              <span>{attachedToName}</span>
              <button type="button" onClick={() => onAttach(null)}>
                Unattach
              </button>
            </div>
          ) : (
            <div className="playtest-ctx-attached playtest-ctx-attached--none">Not attached</div>
          )}
          {attachTargets.length > 0 && (
            // A native <select> rather than a custom list: it stays usable at
            // any board size, opens the platform picker on touch, and is
            // keyboard/screen-reader correct for free.
            <select
              className="playtest-ctx-attach-select"
              value=""
              aria-label={`Attach ${cardName} to`}
              onChange={(e) => {
                if (e.target.value) onAttach(e.target.value);
              }}
            >
              <option value="">{attachedToName ? 'Move to…' : 'Attach to…'}</option>
              {attachTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Stickers</div>
        {/* The reducer hard-caps at 8 per card; mirror it here so the input
            can't silently swallow a 9th (the add would no-op). */}
        {stickers.length >= 8 ? (
          <div className="playtest-ctx-sticker-limit">Sticker limit reached (8 per card).</div>
        ) : (
          <div className="playtest-ctx-sticker-add">
            <input
              type="text"
              value={stickerText}
              onChange={(e) => setStickerText(e.target.value)}
              placeholder="flying"
              maxLength={30}
              aria-label="Sticker text"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSticker();
              }}
            />
            <button
              type="button"
              disabled={!stickerText.trim()}
              onClick={submitSticker}
              aria-label="Add sticker"
            >
              Add
            </button>
          </div>
        )}
        {stickers.map((s, i) => (
          <div key={`${i}-${s}`} className="playtest-ctx-sticker">
            <span>{s}</span>
            <button
              type="button"
              onClick={() => onRemoveSticker(i)}
              aria-label={`Remove sticker ${s}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Move to</div>
        {MOVE_DESTINATIONS.map((z) => (
          <button
            key={destinationKey(z)}
            type="button"
            className="playtest-ctx-action"
            onClick={() => onMoveTo(z.key, z.toIndex)}
          >
            {z.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <CtxMenuShell x={x} y={y} title={cardName} variant={variant} onClose={onClose}>
      {items}
    </CtxMenuShell>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';
import { usePressRepeat } from '@/lib/use-press-repeat';
import type { Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, destinationKey } from '../lib/zones';

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
  /** Current phased-out state — purely a "doesn't interact right now"
   *  reminder flag, no rules enforcement. See `BattlefieldCard.phased`. */
  phased?: boolean;
  variant?: 'floating' | 'sheet';
  onClose(): void;
  onTap(): void;
  onAddCounter(kind: string): void;
  onRemoveCounter(kind: string): void;
  onAddSticker(text: string): void;
  onRemoveSticker(index: number): void;
  onFlip(): void;
  onTransform(): void;
  onTogglePhased(): void;
  /** Token-copy this card. When a multi-card selection is active and includes
   *  this card, the whole selection is copied — `selectionSize` says so. */
  onDuplicate(): void;
  /** How many cards `onDuplicate` will copy (1 unless a selection is live). */
  selectionSize?: number;
  onMoveTo(zone: Zone, toIndex?: number): void;
}

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
const MAX_COUNTER_NAME = 20;

const MENU_MARGIN = 8;

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
  phased = false,
  variant = 'floating',
  onClose,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onAddSticker,
  onRemoveSticker,
  onFlip,
  onTransform,
  onTogglePhased,
  onDuplicate,
  selectionSize = 1,
  onMoveTo,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Sheet variant's items container — separate from menuRef (the floating
  // variant's own outer element) since the two render entirely different DOM.
  const itemsRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const [stickerText, setStickerText] = useState('');
  const [counterText, setCounterText] = useState('');
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');

  useLockBodyScroll();
  useEscapeKey(variant === 'sheet' ? beginClose : onClose);

  useEffect(() => {
    if (variant !== 'floating') return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const safe = getSafeViewport();
    const vw = safe.right;
    const vh = safe.bottom;
    const left = Math.max(MENU_MARGIN, Math.min(x, vw - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(y, vh - rect.height - MENU_MARGIN));
    setClamped({ left, top });
  }, [x, y, variant]);

  // Keyboard-opened menus (no right-click, no long-press) land the menu with
  // nothing focused unless something moves focus into it — a right-click/
  // long-press open leaves focus wherever it already was, which is fine
  // there since the pointer is right on top of the menu it just opened.
  // `visibility: hidden` (floating, pre-clamp) can't receive focus, so this
  // waits for `clamped` before trying on that variant.
  useEffect(() => {
    if (variant === 'floating' && !clamped) return;
    const container = variant === 'floating' ? menuRef.current : itemsRef.current;
    const first = container?.querySelector<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
    );
    first?.focus();
  }, [variant, clamped]);

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
      <button type="button" className="playtest-ctx-action" onClick={onTap}>
        Tap / Untap
      </button>
      <button type="button" className="playtest-ctx-action" onClick={onFlip}>
        Flip face
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
      {canTransform && (
        <button type="button" className="playtest-ctx-action" onClick={onTransform}>
          Transform
        </button>
      )}
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Counters</div>
        {counterKinds.map((k) => (
          <div key={k} className="playtest-ctx-counter">
            <span>{k}</span>
            <span className="playtest-ctx-counter__value" aria-hidden>
              {counters[k] ?? 0}
            </span>
            <CounterStep
              label={`remove ${k}, currently ${counters[k] ?? 0}`}
              onAdjust={() => onRemoveCounter(k)}
            >
              −
            </CounterStep>
            <CounterStep
              label={`add ${k}, currently ${counters[k] ?? 0}`}
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
            placeholder="Other counter (e.g. chapter)"
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
            aria-label="add counter"
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
              <button type="button" onClick={() => onAttach(null)} aria-label="unattach">
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
              placeholder="Add sticker (e.g. flying)"
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
              aria-label="add sticker"
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
              aria-label={`remove sticker ${s}`}
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

  if (variant === 'sheet') {
    return (
      <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
        <div className="card-picker-backdrop" />
        <div
          className={`card-picker-sheet playtest-ctx-sheet${isClosing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={cardName}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="card-picker-handle" aria-hidden />
          <div className="card-picker-header">
            <h2 className="card-picker-title">{cardName}</h2>
          </div>
          <div className="playtest-ctx-menu" ref={itemsRef}>
            {items}
          </div>
          <div className="card-picker-footer">
            <button type="button" className="btn" onClick={() => beginClose()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="playtest-ctx__backdrop" onClick={onClose} />
      <div
        ref={menuRef}
        className="playtest-ctx playtest-ctx-menu"
        style={{
          left: clamped?.left ?? x,
          top: clamped?.top ?? y,
          visibility: clamped ? 'visible' : 'hidden',
        }}
        role="menu"
        aria-label={cardName}
      >
        {items}
      </div>
    </>
  );
}

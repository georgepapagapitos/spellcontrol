import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';
import type { Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS } from '../lib/zones';

interface Props {
  x: number;
  y: number;
  cardName: string;
  stickers: string[];
  variant?: 'floating' | 'sheet';
  onClose(): void;
  onTap(): void;
  onAddCounter(kind: string): void;
  onRemoveCounter(kind: string): void;
  onAddSticker(text: string): void;
  onRemoveSticker(index: number): void;
  onFlip(): void;
  onMoveTo(zone: Zone): void;
}

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];

const MENU_MARGIN = 8;

export function CardContextMenu({
  x,
  y,
  cardName,
  stickers,
  variant = 'floating',
  onClose,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onAddSticker,
  onRemoveSticker,
  onFlip,
  onMoveTo,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const [stickerText, setStickerText] = useState('');
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

  function submitSticker() {
    const text = stickerText.trim();
    if (!text) return;
    onAddSticker(text);
    setStickerText('');
  }

  // Action list — identical markup in both variants; only the surrounding
  // chrome differs (a cursor-anchored popover vs. the shared bottom sheet).
  const items = (
    <>
      <button type="button" className="playtest-ctx-action" onClick={onTap}>
        Tap / Untap
      </button>
      <button type="button" className="playtest-ctx-action" onClick={onFlip}>
        Flip face
      </button>
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Counters</div>
        {COUNTER_KINDS.map((k) => (
          <div key={k} className="playtest-ctx-counter">
            <span>{k}</span>
            <button type="button" onClick={() => onRemoveCounter(k)} aria-label={`remove ${k}`}>
              −
            </button>
            <button type="button" onClick={() => onAddCounter(k)} aria-label={`add ${k}`}>
              +
            </button>
          </div>
        ))}
      </div>
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
            key={z.key}
            type="button"
            className="playtest-ctx-action"
            onClick={() => onMoveTo(z.key)}
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
          <div className="playtest-ctx-menu">{items}</div>
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

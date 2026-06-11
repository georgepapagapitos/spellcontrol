import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TYPE_ORDER } from '@/lib/card-types';
import { ROLE_BADGE_BY_TONE } from '@/lib/role-badges';
import type { RarityTint } from '@/lib/set-symbols';
import { TypeIcon } from './shared/ManaSymbol';
import { SetSymbol } from './shared/SetSymbol';
import { FoilBadge } from './FoilBadge';
import { DeckBadge } from './DeckBadge';
import { BinderBadge } from './BinderBadge';

/**
 * Context-aware symbol key — the "Key" popover that teaches the app's glyph
 * language (T36). Mana symbols and rarity-tinted set symbols are printed on
 * physical cards, but the app-invented glyphs (type icons, role badges, the
 * synergy marker) only explain themselves via `title` tooltips, which don't
 * exist on touch. This popover is the tap-reachable explanation: every entry
 * renders the REAL component/markup next to its word, so the key cannot
 * drift from the UI it describes.
 */
export type LegendContext = 'collection' | 'binder' | 'deck';

/** Stable, real set code for the rarity-tint samples (Modern Horizons 2). */
const SAMPLE_SET_CODE = 'mh2';

const RARITY_WORDS: { rarity: RarityTint; word: string }[] = [
  { rarity: 'mythic', word: 'Mythic' },
  { rarity: 'rare', word: 'Rare' },
  { rarity: 'uncommon', word: 'Uncommon' },
  { rarity: 'common', word: 'Common' },
];

// A few representative role badges (one per top-level role). The exhaustive
// grouped list stays under Show → "What do the role badges mean?".
const ROLE_SAMPLE_TONES = ['ramp', 'mana-rock', 'spot-removal', 'card-draw'];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface LegendProps {
  /** Which surface the key describes — decides which sections appear. */
  context: LegendContext;
  /** Preferred anchor edge (right for right-aligned toolbars) — the popover
   * still clamps/flips to whatever space actually exists. */
  align?: 'left' | 'right';
  /** 'pill' matches toolbar pill controls; 'link' matches inline summary text. */
  variant?: 'link' | 'pill';
}

/**
 * Placement of the portaled popover. Same model as InfoTip (the defined
 * pattern for floating explainers): fixed coordinates from the trigger rect,
 * clamped to the viewport horizontally, below the trigger when there's room
 * and flipped above (bottom-anchored) when there isn't. Hosts like the deck
 * bento establish `container-type` / clip contexts that trap or cut off an
 * in-flow popover — the body portal escapes them.
 */
interface KeyPos {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function Legend({ context, align = 'left', variant = 'link' }: LegendProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<KeyPos | null>(null);
  const open = pos !== null;

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(320, vw - 16);
    // Respect the caller's edge preference, then clamp fully on-screen.
    const preferred = align === 'right' ? r.right - width : r.left;
    const left = Math.max(8, Math.min(preferred, vw - width - 8));
    // Prefer below the trigger; flip above (bottom-anchored, content height
    // unknown) when the lower gutter is shorter than the upper one. The key
    // scrolls internally, so even a short gutter works.
    const below = vh - r.bottom - 14; // 6px gap + 8px screen margin
    const above = r.top - 14;
    if (below >= 240 || below >= above) {
      setPos({ left, width, top: r.bottom + 6, maxHeight: Math.min(below, 480) });
    } else {
      setPos({ left, width, bottom: vh - r.top + 6, maxHeight: Math.min(above, 480) });
    }
  }, [align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The trigger's own click handler toggles; the popover is interactive.
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      close();
    };
    const onScroll = (e: Event) => {
      // The key scrolls internally — only outside scrolls dismiss it.
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const popover = pos && (
    <div
      ref={popRef}
      className="legend-popover"
      role="dialog"
      aria-label="Symbol key"
      style={{
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        top: pos.top,
        bottom: pos.bottom,
      }}
    >
      <Section title="Card types" grid>
        {TYPE_ORDER.map((t) => (
          <Entry key={t} glyph={<TypeIcon type={t} />} word={capitalize(t)} />
        ))}
      </Section>
      <Section title="Set symbol — tinted by rarity" grid>
        {RARITY_WORDS.map(({ rarity, word }) => (
          <Entry
            key={rarity}
            glyph={<SetSymbol setCode={SAMPLE_SET_CODE} rarity={rarity} />}
            word={word}
          />
        ))}
      </Section>
      <Section title="Finish">
        <Entry glyph={<FoilBadge card={{ foil: true }} />} word="Foil printing" />
      </Section>
      {context !== 'deck' && (
        <Section title="Badges">
          <Entry
            interactive
            glyph={
              <DeckBadge
                allocations={[
                  { deckId: 'legend-sample', deckName: 'a deck', deckColor: '', cardName: '' },
                ]}
              />
            }
            word="In a deck"
          />
          <Entry
            interactive
            glyph={
              <BinderBadge binders={[{ id: 'legend-sample', name: 'a binder', color: null }]} />
            }
            word="In a binder"
          />
        </Section>
      )}
      {context === 'binder' && (
        <Section title="Slot border">
          <SlotItem label="Mythic" cls="mythic" />
          <SlotItem label="Rare" cls="rare" />
          <SlotItem label="Uncommon" cls="uncommon" />
          <SlotItem label="Common" cls="common" />
          <SlotItem label="Land" cls="land" />
          <SlotItem label="Empty slot" cls="empty" />
        </Section>
      )}
      {context === 'deck' && (
        <>
          <Section title="Roles">
            {ROLE_SAMPLE_TONES.map((tone) => (
              <Entry
                key={tone}
                glyph={
                  <span className={`deck-row-role-badge deck-row-role-${tone}`}>
                    {ROLE_BADGE_BY_TONE[tone].label}
                  </span>
                }
                word={ROLE_BADGE_BY_TONE[tone].title}
              />
            ))}
            <div className="legend-footnote">Full list: Show → "What do the role badges mean?"</div>
          </Section>
          <Section title="Markers">
            <Entry
              glyph={
                <span className="deck-row-synergy">
                  <span className="deck-row-synergy-icon">✦</span>
                </span>
              }
              word="Synergizes with your commander"
            />
            <Entry
              glyph={
                <span className="deck-row-alloc-chip deck-row-alloc-chip-unowned">unowned</span>
              }
              word="Not in your collection (red count = missing copies)"
            />
            <Entry
              glyph={<span className="deck-row-inclusion">64%</span>}
              word="% of EDHREC decks with this commander run it"
            />
          </Section>
        </>
      )}
    </div>
  );

  return (
    <div className="legend-disclosure">
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'pill' ? 'toolbar-pill' : 'legend-trigger'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Show symbol key"
        onClick={() => (pos ? setPos(null) : place())}
      >
        Key
      </button>
      {popover && createPortal(popover, document.body)}
    </div>
  );
}

function Section({
  title,
  grid,
  children,
}: {
  title: string;
  grid?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="legend-section">
      <h3 className="legend-section-title">{title}</h3>
      <div className={grid ? 'legend-grid' : 'legend-rows'}>{children}</div>
    </section>
  );
}

/**
 * One glyph + word pair. The glyph column is decorative (the word carries the
 * meaning), so it's `aria-hidden`; `interactive` additionally marks the sample
 * `inert` — DeckBadge/BinderBadge render a live link/button, which must not
 * navigate or take focus from inside the key.
 */
function Entry({
  glyph,
  word,
  interactive,
}: {
  glyph: ReactNode;
  word: string;
  interactive?: boolean;
}) {
  return (
    <div className="legend-item">
      <span className="legend-glyph" aria-hidden inert={interactive || undefined}>
        {glyph}
      </span>
      {word}
    </div>
  );
}

/** Binder slot-border swatch (the original binder-only legend entries). */
function SlotItem({ label, cls }: { label: string; cls: string }) {
  return (
    <div className="legend-item">
      <div className={`legend-swatch slot ${cls}`} />
      {label}
    </div>
  );
}

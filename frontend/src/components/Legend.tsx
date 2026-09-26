import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import { TYPE_ORDER } from '@/lib/card-types';
import { ROLE_BADGE_BY_TONE } from '@/lib/role-badges';
import type { RarityTint } from '@/lib/set-symbols';
import { TypeIcon } from './shared/ManaSymbol';
import { SetSymbol } from './shared/SetSymbol';
import { FoilBadge } from './FoilBadge';
import { DeckBadge } from './DeckBadge';
import { makeDeckAllocationInfo } from '@/lib/allocations';
import { BinderBadge } from './BinderBadge';
import { ConditionChip } from './shared/CardRow';
import { CONDITION_OPTIONS } from './PrintingPicker';
import type { Condition } from '@/types';
import { Chip } from '@/components/shared/Chip';

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
 * Placement of the portaled popover. Same model as OverflowMenu (the defined
 * pattern for floating panels): fixed coordinates from the trigger rect via
 * `computePopoverPlacement`, which hands back EITHER `left` or `right` (a
 * right-aligned trigger anchors by its right edge) and either `top` or
 * `bottom` (flipped above when there's no room below). Every coordinate it
 * returns is forwarded as-is — dropping `right` is what once parked the binder
 * Key at the far left of a wide screen. Hosts like the deck bento establish
 * `container-type` / clip contexts that trap or cut off an in-flow popover —
 * the body portal escapes them.
 */
interface KeyPos {
  width: number;
  maxHeight: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export function Legend({ context, align = 'left', variant = 'link' }: LegendProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<KeyPos | null>(null);
  const open = pos !== null;

  const place = useCallback(
    (contentHeight = 240) => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const safe = getSafeViewport();
      const width = Math.min(320, safe.right - safe.left - 16);
      // First pass picks the side; the panel is then capped to the room on
      // that side so a tall key scrolls internally instead of being shoved up
      // over its trigger by the helper's overflow clamp.
      const side = computePopoverPlacement(r, { width, height: contentHeight }, safe, align, 6);
      const room = side.opensAbove ? r.top - safe.top - 14 : safe.bottom - r.bottom - 14;
      const maxHeight = Math.max(0, Math.min(room, 480));
      const placement = computePopoverPlacement(
        r,
        { width, height: Math.min(contentHeight, maxHeight) },
        safe,
        align,
        6
      );
      setPos({
        width,
        maxHeight,
        left: placement.left,
        right: placement.right,
        top: placement.top,
        bottom: placement.bottom,
      });
    },
    [align]
  );

  // The opening click places the key against an estimate; once it has
  // rendered, re-place it against its real content height — each context's
  // key is a different size, and the side/cap decisions depend on it.
  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    place(popRef.current.scrollHeight);
  }, [open, place]);

  // Viewport changes (rotation, window resize, the native keyboard) move the
  // trigger and the safe box together — follow them rather than dismiss.
  useEffect(() => {
    if (!open) return;
    const follow = () => popRef.current && place(popRef.current.scrollHeight);
    window.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('resize', follow);
    };
  }, [open, place]);

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
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
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
        width: pos.width,
        maxHeight: pos.maxHeight,
        left: pos.left,
        right: pos.right,
        top: pos.top,
        bottom: pos.bottom,
      }}
    >
      <LegendContent context={context} />
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

/**
 * The key's sections, sans positioning — also embedded in the collection
 * toolbar's narrow-viewport "View" popover, where the key is a sub-page of
 * the panel rather than its own floating dialog.
 */
export function LegendContent({ context }: { context: LegendContext }) {
  return (
    <>
      <Section title="Card types" grid>
        {TYPE_ORDER.map((t) => (
          <Entry key={t} glyph={<TypeIcon type={t} />} word={capitalize(t)} />
        ))}
      </Section>
      <Section title="Set symbol · Tinted by rarity" grid>
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
                allocations={[makeDeckAllocationInfo('legend-sample', 'a deck', '', '')]}
              />
            }
            word="In a deck"
          />
          <Entry
            interactive
            glyph={
              <DeckBadge
                allocations={[
                  {
                    ownerKind: 'cube',
                    ownerId: 'legend-cube',
                    ownerName: 'a cube',
                    ownerColor: 'var(--cube-color)',
                    deckId: '',
                    deckName: 'a cube',
                    deckColor: 'var(--cube-color)',
                    cardName: '',
                  },
                ]}
              />
            }
            word="In a physical cube"
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
      {/* Binder list rows render the same CardRow chips, so the binder Key
          carries the section too (glyph-literacy rule: Key entry per surface). */}
      {(context === 'collection' || context === 'binder') && (
        <Section title="Condition · Near Mint unmarked">
          {CONDITION_OPTIONS.filter((o) => o.value !== '' && o.value !== 'nm').map((o) => (
            <Entry
              key={o.value}
              glyph={<ConditionChip condition={o.value as Condition} />}
              word={o.label as string}
            />
          ))}
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
          <Section title="Your tags">
            <Entry
              glyph={<Chip className="deck-row-tag-chip">Wincon</Chip>}
              word="A tag you applied — press and hold a row's tag button, then swipe"
            />
            <div className="legend-footnote">
              Role badges are detected automatically; tags are yours. Ramp / Draw / Removal /
              Interaction tags also count toward role health in Analysis.
            </div>
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
                <Chip className="deck-row-alloc-chip deck-row-alloc-chip-unowned">unowned</Chip>
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
    </>
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

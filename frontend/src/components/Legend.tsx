import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Anchor the popover to the trigger's right edge (for right-aligned toolbars). */
  align?: 'left' | 'right';
  /** 'pill' matches toolbar pill controls; 'link' matches inline summary text. */
  variant?: 'link' | 'pill';
}

export function Legend({ context, align = 'left', variant = 'link' }: LegendProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="legend-disclosure" ref={ref}>
      <button
        type="button"
        className={variant === 'pill' ? 'toolbar-pill' : 'legend-trigger'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Show symbol key"
        onClick={() => setOpen((v) => !v)}
      >
        Key
      </button>
      {open && (
        <div
          className={`legend-popover${align === 'right' ? ' legend-popover--right' : ''}`}
          role="dialog"
          aria-label="Symbol key"
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
                <div className="legend-footnote">
                  Full list: Show → "What do the role badges mean?"
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
      )}
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

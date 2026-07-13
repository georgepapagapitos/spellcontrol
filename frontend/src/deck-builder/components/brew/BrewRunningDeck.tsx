import { useEffect, useMemo, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './BrewRunningDeck.css';
import { MeterBar } from '@/components/shared/MeterBar';
import { buildManaData } from '@/lib/build-mana-data';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useCardThumb } from '@/lib/card-thumbs';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { useBrewStore } from '@/deck-builder/store/brew';
import { flattenAccepted } from '@/deck-builder/services/deckBuilder/brewSlots';
import { COLOR_INFO } from '@/lib/colors';
import type { ScryfallCard } from '@/deck-builder/types';

const CURVE_BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7];
const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

interface BrewRunningDeckProps {
  commander: ScryfallCard | null;
}

function useResolvedAccepted(commander: ScryfallCard | null) {
  const accepted = useBrewStore((s) => s.accepted);
  const slots = useBrewStore((s) => s.slots);
  const names = useMemo(
    () => flattenAccepted(accepted, slots).map((c) => c.name),
    [accepted, slots]
  );
  const [cards, setCards] = useState<ScryfallCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Resolves to an empty map for an empty name list — no special-casing needed.
    getCardsByNames(names).then((resolved) => {
      if (cancelled) return;
      setCards(names.map((n) => resolved.get(n)).filter((c): c is ScryfallCard => !!c));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the resolved name list
  }, [names.join('|')]);

  return useMemo(() => buildManaData(cards, commander, null), [cards, commander]);
}

/** Small portrait art thumb for a pick row — the tactile "physical card" cue
 *  the meters-only panel lacked (E128). Resolves via the batched CDN thumb
 *  hook (never the rate-limited API host); decorative, since the row's own
 *  name text already carries the accessible label. Renders a neutral
 *  placeholder box while the thumb resolves or on a resolve miss, matching
 *  the established `RowThumb`/`Thumb` pattern (CardSearchPanel/DeckCardRow) —
 *  no error state beyond that placeholder. */
function PickThumb({ name }: { name: string }): JSX.Element {
  const url = useCardThumb(name, 'small');
  return (
    <span className="brew-running-item-thumb" aria-hidden>
      {url && <img src={url} alt="" loading="lazy" />}
    </span>
  );
}

function RunningDeckBody({ commander }: BrewRunningDeckProps): JSX.Element {
  const slots = useBrewStore((s) => s.slots);
  const accepted = useBrewStore((s) => s.accepted);
  const reconsider = useBrewStore((s) => s.reconsider);
  const nonlandTotal = useBrewStore((s) => s.nonlandTotal);
  const manaData = useResolvedAccepted(commander);
  const total = Object.values(accepted).reduce((sum, cards) => sum + cards.length, 0);
  const maxCurve = Math.max(1, ...CURVE_BUCKETS.map((cmc) => manaData.manaCurve[cmc] ?? 0));
  const maxColor = Math.max(1, ...COLOR_KEYS.map((c) => manaData.colorDist.counts[c] ?? 0));

  return (
    <div className="brew-running-body">
      <div className="brew-running-section">
        <h3>Curve</h3>
        <div className="brew-running-curve">
          {CURVE_BUCKETS.map((cmc) => (
            <div key={cmc} className="brew-running-curve-row">
              <span className="brew-running-curve-label">{cmc === 7 ? '7+' : cmc}</span>
              <MeterBar value={manaData.manaCurve[cmc] ?? 0} max={maxCurve} size="sm" />
              <span className="brew-running-curve-count">{manaData.manaCurve[cmc] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="brew-running-section">
        <h3>Color balance</h3>
        <div className="brew-running-colors">
          {COLOR_KEYS.map((key) => {
            const info = COLOR_INFO[key];
            const count = manaData.colorDist.counts[key] ?? 0;
            if (count === 0) return null;
            return (
              <div key={key} className="brew-running-curve-row">
                <span className="brew-running-curve-label">{info?.label ?? key}</span>
                <MeterBar value={count} max={maxColor} size="sm" color={info?.pip} />
                <span className="brew-running-curve-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="brew-running-section">
        <h3>
          Picks ({total}/{nonlandTotal})
        </h3>
        {total === 0 ? (
          <p className="brew-running-empty">Nothing added yet — your first picks show up here.</p>
        ) : (
          <ul className="brew-running-list">
            {slots.map((slot) =>
              (accepted[slot.key] ?? []).map((c) => (
                <li key={`${slot.key}:${c.name}`} className="brew-running-item">
                  <PickThumb name={c.name} />
                  <span className="brew-running-item-body">
                    <span className="brew-running-item-slot">{slot.label}</span>
                    <span className="brew-running-item-name">{c.name}</span>
                  </span>
                  <button
                    type="button"
                    className="brew-running-item-remove"
                    onClick={() => reconsider(slot.key, c.name)}
                    aria-label={`Remove ${c.name} and reconsider`}
                  >
                    <X width={12} height={12} aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunningDeckSheet({
  commander,
  onClose,
}: BrewRunningDeckProps & { onClose: () => void }): JSX.Element {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose);
  return createPortal(
    <div
      className={`brew-running-sheet-backdrop${isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) beginClose();
      }}
    >
      <div
        className={`brew-running-sheet${isClosing ? ' is-closing' : ''}`}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label="Deck so far"
      >
        <div className="brew-running-sheet-header">
          <h2>Deck so far</h2>
          <button
            type="button"
            className="brew-running-sheet-close"
            onClick={() => beginClose()}
            aria-label="Close"
          >
            <X width={16} height={16} aria-hidden />
          </button>
        </div>
        <div className="brew-running-sheet-body">
          <RunningDeckBody commander={commander} />
        </div>
      </div>
    </div>,
    document.body
  );
}

/** The live running-deck panel: full inline on desktop, a collapsed summary
 * bar + bottom sheet on small viewports (STYLE_GUIDE overlay pattern). */
export function BrewRunningDeck({ commander }: BrewRunningDeckProps): JSX.Element {
  const [sheetOpen, setSheetOpen] = useState(false);
  const accepted = useBrewStore((s) => s.accepted);
  const nonlandTotal = useBrewStore((s) => s.nonlandTotal);
  const total = Object.values(accepted).reduce((sum, cards) => sum + cards.length, 0);

  return (
    <>
      <aside className="brew-running-deck" aria-label="Deck so far">
        <h2 className="brew-running-title">
          Deck so far · {total}/{nonlandTotal}
        </h2>
        <RunningDeckBody commander={commander} />
      </aside>

      <button
        type="button"
        className="brew-running-bar"
        onClick={() => setSheetOpen(true)}
        aria-label={`View deck so far, ${total} of ${nonlandTotal} cards`}
      >
        <span>
          {total}/{nonlandTotal} cards
        </span>
        <span className="brew-running-bar-cta">View deck</span>
      </button>

      {sheetOpen && <RunningDeckSheet commander={commander} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

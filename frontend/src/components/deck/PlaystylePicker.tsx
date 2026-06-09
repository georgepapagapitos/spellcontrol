import { useEffect, useMemo, useState } from 'react';
import { fetchPlaystyleCommanders } from '@/deck-builder/services/edhrec/client';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import { PLAYSTYLES, type Playstyle } from '../../lib/commander-playstyle-index';
import type { EnrichedCard } from '../../types';
import { ColorPip } from '../shared/ManaSymbol';

interface Props {
  onSelectCommander: (card: ScryfallCard) => void;
}

// Shared with CommanderSearch so "use my collection" stays one preference
// across both the by-commander and by-play-style paths.
const OWNED_ONLY_KEY = 'commander-search-owned-only';

function isLegendaryCreature(card: EnrichedCard): boolean {
  const tl = (card.typeLine?.split('//')[0] ?? '').toLowerCase();
  return tl.includes('legendary') && tl.includes('creature');
}

export function PlaystylePicker({ onSelectCommander }: Props) {
  const [style, setStyle] = useState<Playstyle | null>(null);
  const [commanders, setCommanders] = useState<EDHRECTopCommander[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const collectionCards = useCollectionStore((s) => s.cards);
  // De-dup by name: the collection stores one row per physical copy, so a
  // card owned in multiples would otherwise inflate the legend count.
  const collectionLegends = useMemo(() => {
    const seen = new Set<string>();
    const out: EnrichedCard[] = [];
    for (const c of collectionCards) {
      if (!isLegendaryCreature(c) || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
    return out;
  }, [collectionCards]);
  const ownedNames = useMemo(
    () => new Set(collectionLegends.map((c) => c.name)),
    [collectionLegends]
  );

  const [ownedOnly, setOwnedOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OWNED_ONLY_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!style) return;
    const activeStyle = style;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setCommanders([]);
      try {
        const list = await fetchPlaystyleCommanders(activeStyle.edhrecSlug);
        if (cancelled) return;
        if (list.length === 0) setError('No commanders found for that play style.');
        setCommanders(list);
      } catch {
        if (!cancelled) setError('Could not load commanders for that play style.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [style]);

  const visibleCommanders = useMemo(
    () => (ownedOnly ? commanders.filter((c) => ownedNames.has(c.name)) : commanders),
    [commanders, ownedOnly, ownedNames]
  );

  const handlePick = async (name: string) => {
    setResolving(name);
    setError(null);
    try {
      const card = await getCardByName(name, true);
      onSelectCommander(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that commander.');
    } finally {
      setResolving(null);
    }
  };

  // Shared across both screens so the preference is always reachable.
  const ownedToggle =
    collectionLegends.length > 0 || ownedOnly ? (
      <label className="commander-owned-toggle">
        <input
          type="checkbox"
          checked={ownedOnly}
          onChange={(e) => {
            const next = e.target.checked;
            setOwnedOnly(next);
            try {
              localStorage.setItem(OWNED_ONLY_KEY, String(next));
            } catch {
              /* ignore */
            }
          }}
        />
        <span>
          Commanders I own
          {collectionLegends.length > 0 && (
            <span className="commander-owned-count">
              {' '}
              ({collectionLegends.length.toLocaleString()} legend
              {collectionLegends.length === 1 ? '' : 's'})
            </span>
          )}
        </span>
      </label>
    ) : null;

  if (!style) {
    return (
      <div className="playstyle-picker">
        <p className="playstyle-picker-hint">
          Pick how you want to play. We’ll show the commanders that do it best on EDHREC.
        </p>
        {ownedToggle}
        <div className="playstyle-grid">
          {PLAYSTYLES.map((s) => (
            <button key={s.id} type="button" className="playstyle-card" onClick={() => setStyle(s)}>
              <span className="playstyle-card-label">{s.label}</span>
              <span className="playstyle-card-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="playstyle-picker">
      <div className="playstyle-picker-bar">
        <button type="button" className="btn-link" onClick={() => setStyle(null)}>
          ← All play styles
        </button>
        <span className="playstyle-picker-current">{style.label}</span>
      </div>
      <p className="playstyle-picker-hint">{style.blurb}</p>
      {ownedToggle}

      {loading ? (
        <p className="commander-suggestions-empty">Loading commanders…</p>
      ) : visibleCommanders.length === 0 ? (
        <p className="commander-suggestions-empty">
          {ownedOnly && commanders.length > 0
            ? 'You don’t own any of EDHREC’s top commanders for that play style.'
            : 'No commanders found.'}
        </p>
      ) : (
        <ul className="commander-suggestion-chips">
          {visibleCommanders.map((c) => {
            const colors = c.colorIdentity.length > 0 ? c.colorIdentity : ['C'];
            return (
              <li key={c.sanitized || c.name}>
                <button
                  type="button"
                  className="commander-suggestion-chip"
                  onClick={() => void handlePick(c.name)}
                  disabled={resolving !== null}
                >
                  <span className="commander-suggestion-pips" aria-hidden>
                    {colors.map((color) => (
                      <ColorPip key={color} color={color} pip={false} />
                    ))}
                  </span>
                  <span>{resolving === c.name ? 'Loading…' : c.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="commander-search-error">{error}</p>}
    </div>
  );
}

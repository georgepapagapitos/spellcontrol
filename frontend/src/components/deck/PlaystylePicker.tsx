import { useEffect, useMemo, useState } from 'react';
import { fetchPlaystyleCommanders } from '@/deck-builder/services/edhrec/client';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import { type Playstyle } from '../../lib/commander-playstyle-index';
import { extractCommanderCandidates } from '../../lib/commander-readiness';
import { PlaystyleGrid } from './PlaystyleGrid';
import { CommanderResultCard } from './CommanderResultCard';

interface Props {
  onSelectCommander: (card: ScryfallCard) => void;
}

// Shared with CommanderSearch so "use my collection" stays one preference
// across both the by-commander and by-play-style paths.
const OWNED_ONLY_KEY = 'commander-search-owned-only';
const PLAYSTYLE_PREVIEW_COUNT = 10;

export function PlaystylePicker({ onSelectCommander }: Props) {
  const [style, setStyle] = useState<Playstyle | null>(null);
  const [commanders, setCommanders] = useState<EDHRECTopCommander[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllCommanders, setShowAllCommanders] = useState(false);

  const collectionCards = useCollectionStore((s) => s.cards);
  // De-dup by name via the shared `isCommanderEligible` (extractCommanderCandidates):
  // the collection stores one row per physical copy, so a card owned in multiples
  // would otherwise inflate the legend count. Using the shared check also catches
  // non-creature commanders ("can be your commander" planeswalkers/backgrounds).
  const collectionLegends = useMemo(
    () => extractCommanderCandidates(collectionCards),
    [collectionCards]
  );
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
  const commanderResultKey = `${style?.id ?? ''}|${ownedOnly}|${visibleCommanders
    .map((c) => c.name)
    .join('|')}`;
  const [prevCommanderResultKey, setPrevCommanderResultKey] = useState(commanderResultKey);
  if (prevCommanderResultKey !== commanderResultKey) {
    setPrevCommanderResultKey(commanderResultKey);
    setShowAllCommanders(false);
  }

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
        <PlaystyleGrid onSelect={setStyle} />
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
        <>
          <ul className="commander-result-grid">
            {(showAllCommanders
              ? visibleCommanders
              : visibleCommanders.slice(0, PLAYSTYLE_PREVIEW_COUNT)
            ).map((c) => {
              const colors = c.colorIdentity.length > 0 ? c.colorIdentity : ['C'];
              return (
                <li key={c.sanitized || c.name}>
                  <CommanderResultCard
                    name={c.name}
                    colors={colors}
                    selecting={resolving === c.name}
                    disabled={resolving !== null}
                    onSelect={() => void handlePick(c.name)}
                  />
                </li>
              );
            })}
          </ul>
          {visibleCommanders.length > PLAYSTYLE_PREVIEW_COUNT && (
            <button
              type="button"
              className="commander-playstyle-more"
              onClick={() => setShowAllCommanders((v) => !v)}
            >
              {showAllCommanders ? 'Show fewer' : `Show all ${visibleCommanders.length}`}
            </button>
          )}
        </>
      )}

      {error && <p className="commander-search-error">{error}</p>}
    </div>
  );
}

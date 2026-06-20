import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPartnerType,
  getPartnerTypeLabel,
  getPartnerWithName,
} from '@/deck-builder/lib/partnerUtils';
import { searchValidPartners } from '@/deck-builder/services/scryfall/client';
import { fetchPartnerPopularity } from '@/deck-builder/services/edhrec/client';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import { OwnershipBadge } from './OwnershipBadge';
import { SearchPill } from '../SearchPill';
import { ManaCost } from '../ManaCost';

interface Props {
  /** The primary commander — drives which partners are legal. */
  commander: ScryfallCard;
  /** Currently-selected partner, or null. */
  partner: ScryfallCard | null;
  /** Set or clear the partner commander. */
  onSelect: (card: ScryfallCard | null) => void;
  /** Whether the build is constrained to the user's collection. */
  collectionMode: boolean;
}

// Human-readable hint describing how this commander's partner mechanic works.
function partnerHint(partnerType: ReturnType<typeof getPartnerType>, withName: string | null) {
  switch (partnerType) {
    case 'partner':
      return 'pair it with any other commander that also has Partner.';
    case 'partner-with':
      return withName
        ? `it partners specifically with ${withName}.`
        : 'it partners with one specific commander.';
    case 'friends-forever':
      return 'pair it with another commander that has Friends forever.';
    case 'choose-background':
      return 'pair it with a Background enchantment.';
    case 'doctor':
      return "pair it with a companion that has Doctor's companion.";
    case 'doctors-companion':
      return 'pair it with a Time Lord Doctor.';
    default:
      return '';
  }
}

function formatDeckCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k decks`;
  return `${count} deck${count === 1 ? '' : 's'}`;
}

export function PartnerCommanderSelector({ commander, partner, onSelect, collectionMode }: Props) {
  const partnerType = useMemo(() => getPartnerType(commander), [commander]);
  const partnerWithName = useMemo(() => getPartnerWithName(commander), [commander]);

  // "Partner with X" has exactly one legal partner, so there's nothing to
  // search — the picker shows that single card as a one-click suggestion.
  const canSearch = partnerType !== 'partner-with';

  const [enabled, setEnabled] = useState(!!partner);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [popularity, setPopularity] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owned legal partners from the unfiltered fetch — drives the collection
  // warning so it doesn't flicker as the user types a query.
  const [ownedBaseCount, setOwnedBaseCount] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  const collectionCards = useCollectionStore((s) => s.cards);
  const ownedNames = useMemo(() => new Set(collectionCards.map((c) => c.name)), [collectionCards]);

  // In collection mode the deck is constrained to owned cards, so an unowned
  // partner can't be built — show only owned legal partners. Then rank by
  // EDHREC popularity (most-played pairings first), alphabetical as a
  // fallback for partners EDHREC has no pairing data for.
  const ranked = useMemo(() => {
    const visible = collectionMode ? results.filter((c) => ownedNames.has(c.name)) : results;
    return [...visible].sort((a, b) => {
      const diff = (popularity.get(b.name) ?? 0) - (popularity.get(a.name) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [results, collectionMode, ownedNames, popularity]);

  // Fetch EDHREC partner popularity once when the picker opens — used purely
  // to rank suggestions, never to gate them.
  useEffect(() => {
    if (!enabled || partner) return;
    let cancelled = false;
    fetchPartnerPopularity(commander.name)
      .then((map) => {
        if (!cancelled) setPopularity(map);
      })
      .catch(() => {
        if (!cancelled) setPopularity(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, partner, commander.name]);

  // Search for valid partners — debounced. Re-runs as the query changes.
  useEffect(() => {
    if (!enabled || partner) return;
    let cancelled = false;
    async function run() {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, query.trim() ? 220 : 0);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const cards = await searchValidPartners(commander, canSearch ? query.trim() : '');
        if (cancelled) return;
        setResults(cards);
        // Record how many legal partners the user owns, but only from the
        // unfiltered (empty-query) fetch so the warning is stable.
        if (!query.trim()) {
          setOwnedBaseCount(cards.filter((c) => ownedNames.has(c.name)).length);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load partners.');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [enabled, partner, commander, query, canSearch, ownedNames]);

  if (partnerType === 'none') return null;

  const typeLabel = getPartnerTypeLabel(partnerType);

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    if (!next) {
      // Turning the toggle off clears any chosen partner.
      onSelect(null);
      setQuery('');
      setResults([]);
    }
  };

  // None of this commander's legal partners are in the collection.
  const showCollectionWarning =
    enabled && !partner && collectionMode && !loading && !error && ownedBaseCount === 0;

  // ── Selected-partner view ─────────────────────────────────────────────
  if (partner) {
    const front = partner.card_faces?.[0];
    const manaCost = partner.mana_cost ?? front?.mana_cost ?? '';
    const oracleText = partner.oracle_text ?? front?.oracle_text ?? '';
    // Collection mode constrains the build to owned cards. If the partner
    // was picked before collection mode was turned on (or the collection
    // changed), warn so the user knows the generator can't actually build
    // around this partner.
    const partnerNotOwned = collectionMode && !ownedNames.has(partner.name);
    return (
      <section className="deck-builder-section partner-selector">
        <h2 className="deck-builder-section-title">Partner commander</h2>
        {partnerNotOwned && (
          <p className="partner-warning" role="status">
            {partner.name} isn&rsquo;t in your collection. Pick a different partner, remove it, or
            turn off &ldquo;Build from my collection&rdquo; to keep this pairing.
          </p>
        )}
        <div className="commander-pick">
          <img
            className="commander-pick-art"
            src={
              partner.image_uris?.normal ??
              front?.image_uris?.normal ??
              partner.image_uris?.large ??
              partner.image_uris?.art_crop ??
              front?.image_uris?.art_crop
            }
            alt=""
            aria-hidden="true"
          />
          <div className="commander-pick-body">
            <div className="commander-pick-headline">
              <span className="commander-pick-name">{partner.name}</span>
              {manaCost && <ManaCost cost={manaCost} className="commander-pick-mana" />}
            </div>
            <div className="commander-pick-type">{partner.type_line}</div>
            {oracleText && (
              <div className="commander-pick-oracle">
                {oracleText.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn commander-pick-change"
            onClick={() => {
              onSelect(null);
              setQuery('');
              setResults([]);
            }}
          >
            Change
          </button>
        </div>
      </section>
    );
  }

  // ── Toggle + picker view ──────────────────────────────────────────────
  return (
    <section className="deck-builder-section partner-selector">
      <h2 className="deck-builder-section-title">Partner commander</h2>
      <p className="partner-selector-intro">
        {commander.name} has <strong>{typeLabel}</strong> —{' '}
        {partnerHint(partnerType, partnerWithName)}
      </p>

      <label className={`partner-toggle${enabled ? ' active' : ''}`}>
        <input
          type="checkbox"
          className="partner-toggle-checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span className="partner-toggle-text">
          <span className="partner-toggle-title">Add a partner commander</span>
          <span className="partner-toggle-sub">
            {enabled
              ? 'Pick a second commander — its colors join the deck.'
              : 'Build a two-commander deck across both color identities.'}
          </span>
        </span>
      </label>

      {showCollectionWarning && (
        <p className="partner-warning" role="status">
          None of {commander.name}&rsquo;s legal partners are in your collection. Turn off
          &ldquo;Build from my collection&rdquo; or import one to pair it.
        </p>
      )}

      {enabled && (
        <div className="partner-picker">
          {canSearch && (
            <SearchPill
              inputType="text"
              placeholder="Search valid partners…"
              value={query}
              onChange={setQuery}
              ariaLabel="Search valid partner commanders"
            />
          )}

          <div className="commander-search-panel partner-panel">
            {loading ? (
              <p className="commander-search-status">Loading partners…</p>
            ) : error ? (
              <p className="commander-search-status partner-panel-error">{error}</p>
            ) : ranked.length === 0 ? (
              <p className="commander-search-status">
                {collectionMode
                  ? 'No legal partners in your collection.'
                  : 'No valid partners found.'}
              </p>
            ) : (
              <ul className="commander-search-results" role="listbox">
                {ranked.map((card) => {
                  const count = popularity.get(card.name) ?? 0;
                  const owned = ownedNames.has(card.name);
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="commander-search-item partner-result"
                        onClick={() => onSelect(card)}
                      >
                        <span className="partner-result-main">
                          <span className="commander-search-item-name">{card.name}</span>
                          <span className="commander-search-item-type">{card.type_line}</span>
                        </span>
                        <span className="partner-result-meta">
                          <OwnershipBadge owned={owned} />
                          {count > 0 && (
                            <span className="partner-result-count">{formatDeckCount(count)}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

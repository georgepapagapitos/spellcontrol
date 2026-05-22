import { Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboard } from '@/lib/keyboard';
import { searchCommanders, getCardByName } from '@/deck-builder/services/scryfall/client';
import {
  fetchTopCommanders,
  fetchAllCommanderNames,
  fetchCommandersIncludingColors,
} from '@/deck-builder/services/edhrec/client';
import type { ScryfallCard, EDHRECTopCommander } from '@/deck-builder/types';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';
import { ManaCost } from '../ManaCost';

interface Props {
  value: ScryfallCard | null;
  onSelect: (card: ScryfallCard | null) => void;
}

const WUBRG_ORDER = 'WUBRGC';
const COLORS: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLOR_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};
// Map a sorted color key (e.g. "UBR") to its canonical MTG color-combo name.
const COLOR_COMBO: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
  WU: 'Azorius',
  WB: 'Orzhov',
  WR: 'Boros',
  WG: 'Selesnya',
  UB: 'Dimir',
  UR: 'Izzet',
  UG: 'Simic',
  BR: 'Rakdos',
  BG: 'Golgari',
  RG: 'Gruul',
  WUB: 'Esper',
  WUR: 'Jeskai',
  WUG: 'Bant',
  WBR: 'Mardu',
  WBG: 'Abzan',
  WRG: 'Naya',
  UBR: 'Grixis',
  UBG: 'Sultai',
  URG: 'Temur',
  BRG: 'Jund',
  WUBR: 'Yore-Tiller',
  WUBG: 'Witch-Maw',
  WURG: 'Ink-Treader',
  WBRG: 'Dune-Brood',
  UBRG: 'Glint-Eye',
  WUBRG: 'Five-Color',
};

const OWNED_ONLY_KEY = 'commander-search-owned-only';
const COLOR_FILTER_KEY = 'commander-search-color-filter';

function getColorFilterLabel(colors: Set<string>): string {
  if (colors.size === 0) return 'Top';
  const sorted = [...colors]
    .sort((a, b) => WUBRG_ORDER.indexOf(a) - WUBRG_ORDER.indexOf(b))
    .join('');
  const name = COLOR_COMBO[sorted];
  return name ? `Top ${name}` : 'Top';
}

function isLegendaryCreature(card: EnrichedCard): boolean {
  // Use only the front face type line so DFC backs (e.g. Battles) don't slip in.
  const tl = (card.typeLine?.split('//')[0] ?? '').toLowerCase();
  return tl.includes('legendary') && tl.includes('creature');
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function CommanderSearch({ value, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [open, setOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // On phones the results render as a tray docked above the on-screen
  // keyboard (a popover under the input would sit behind the keyboard).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  const { inset: keyboardInset, viewportHeight } = useKeyboard();

  const collectionCards = useCollectionStore((s) => s.cards);
  // The collection stores one row per physical copy, so a card owned in
  // multiples (or across printings) appears many times. Commander selection
  // only cares about the card identity, so de-dup by name — otherwise the
  // search dropdown, Random pool and suggestion chips all show repeats.
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
  const [colorFilter, setColorFilterState] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLOR_FILTER_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const setColorFilter = (update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setColorFilterState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      try {
        localStorage.setItem(COLOR_FILTER_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Top commanders from EDHREC, filtered by colorFilter. Kept loaded so the
  // empty-query state always has chips to click. (Reference repo refetches
  // on every filter change — we mirror that.)
  const [topCommanders, setTopCommanders] = useState<EDHRECTopCommander[]>([]);
  const [topLoading, setTopLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) setTopLoading(true);
      try {
        const data = await fetchTopCommanders([...colorFilter]);
        if (!cancelled) setTopCommanders(data);
      } catch {
        if (!cancelled) setTopCommanders([]);
      } finally {
        if (!cancelled) setTopLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [colorFilter]);

  // Local search results (owned mode). Kept in state so the dropdown can read
  // it without recomputing on every render. Declared before the search effect
  // so setLocalResults is in scope when the effect uses it.
  const [localResults, setLocalResults] = useState<EnrichedCard[]>([]);

  // Reset local results when switching out of owned-only mode.
  const [prevOwnedOnly, setPrevOwnedOnly] = useState(ownedOnly);
  if (prevOwnedOnly !== ownedOnly) {
    setPrevOwnedOnly(ownedOnly);
    if (!ownedOnly) setLocalResults([]);
  }

  // On phones the results tray docks above the keyboard and grows upward, so
  // a tall result list would cover the search input. When the tray opens,
  // pull the input to the top of the scroll region so it stays visible above
  // the tray.
  const trayOpen =
    isMobile &&
    open &&
    query.trim().length >= 2 &&
    (searchLoading || (ownedOnly ? localResults.length > 0 : results.length > 0));
  useEffect(() => {
    if (trayOpen) inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [trayOpen]);

  // Search effect — switches source by ownedOnly. Scryfall when off, local
  // collection-legend filter when on.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setError(null);
          setResults([]);
        }
        return;
      }
      if (ownedOnly) {
        const ql = q.toLowerCase();
        // Rank hits so the closest match leads: exact name, then prefix, then
        // any substring; ties broken alphabetically.
        const rank = (name: string): number => {
          const n = name.toLowerCase();
          if (n === ql) return 0;
          if (n.startsWith(ql)) return 1;
          return 2;
        };
        const matched = collectionLegends
          .filter((c) => c.name.toLowerCase().includes(ql))
          .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
        // Resolve full ScryfallCards lazily — we don't need them in the list,
        // just for the final selection. Show owned legends as a name+type list.
        // To keep typing snappy we don't pre-fetch; click handler hits Scryfall.
        if (!cancelled) {
          setError(null);
          setResults([]); // not used for owned mode; we render `localResults` directly
          // store local results into a separate memo via state to avoid rerender churn:
          setLocalResults(matched.slice(0, 12));
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 220);
      });
      if (cancelled) return;
      setSearchLoading(true);
      setError(null);
      try {
        const cards = await searchCommanders(q);
        if (!cancelled) setResults(cards.slice(0, 12));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, ownedOnly, collectionLegends]);

  // Filter top commanders: hide split-card "//" entries; in owned mode,
  // surface only those the user actually has so the chip row reads as
  // "what can I build right now" rather than aspirational.
  // NOTE: this useMemo MUST live above the `if (value) return` below — moving
  // it past the early return would mismatch the hooks count when the user
  // picks a commander.
  const visibleTop = useMemo(() => {
    const base = topCommanders.filter((c) => !c.name.includes('//'));
    if (!ownedOnly) return base;

    const owned = base.filter((c) => ownedNames.has(c.name));
    const MIN = 10;
    if (owned.length >= MIN) return owned;

    // Pad with the user's other owned legends so the empty-query state isn't
    // sparse just because their owned legends rarely overlap with EDHREC's top
    // list. Respect the same exact-match color filter Surprise-me uses.
    const seen = new Set(owned.map((c) => c.name));
    const fillerSource = collectionLegends.filter((c) => {
      if (seen.has(c.name)) return false;
      if (colorFilter.size === 0) return true;
      const ci = c.colorIdentity ?? [];
      if (ci.length !== colorFilter.size) return false;
      return ci.every((color) => colorFilter.has(color));
    });

    const filler: EDHRECTopCommander[] = fillerSource.slice(0, MIN - owned.length).map((c, i) => ({
      rank: owned.length + i + 1,
      name: c.name,
      sanitized: c.scryfallId ?? c.name,
      colorIdentity: c.colorIdentity ?? [],
      numDecks: 0,
    }));

    return [...owned, ...filler];
  }, [topCommanders, ownedOnly, ownedNames, collectionLegends, colorFilter]);

  // ── Selection handlers ────────────────────────────────────────────────
  const selectCard = (card: ScryfallCard) => {
    onSelect(card);
    setOpen(false);
    setQuery('');
    setResults([]);
    setLocalResults([]);
  };

  const selectByName = async (name: string) => {
    setSearchLoading(true);
    setError(null);
    try {
      const card = await getCardByName(name, true);
      selectCard(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load card');
    } finally {
      setSearchLoading(false);
    }
  };

  // Surprise me — random pick, respecting owned-only and color filter.
  const handleSurpriseMe = async () => {
    setError(null);
    setRandomLoading(true);
    try {
      if (ownedOnly) {
        const pool = collectionLegends.filter((c) => {
          if (colorFilter.size === 0) return true;
          const ci = c.colorIdentity ?? [];
          // Exact-match: a single-color filter shouldn't surface multicolor
          // commanders that just happen to include that color.
          if (ci.length !== colorFilter.size) return false;
          return ci.every((color) => colorFilter.has(color));
        });
        const fallback =
          colorFilter.size > 0 && pool.length === 0
            ? collectionLegends.filter((c) => {
                const ci = c.colorIdentity ?? [];
                return ci.every((color) => colorFilter.has(color));
              })
            : pool;
        const pick = pickRandom(fallback.length > 0 ? fallback : collectionLegends);
        if (!pick) {
          setError('No legendary creatures in your collection match that filter.');
          return;
        }
        await selectByName(pick.name);
        return;
      }
      // Online — pick from the EDHREC commander list, narrowed by color.
      if (colorFilter.size > 0) {
        const all = await fetchCommandersIncludingColors([...colorFilter]);
        const exact = all.filter(
          (c) =>
            c.colorIdentity.length === colorFilter.size &&
            c.colorIdentity.every((color) => colorFilter.has(color))
        );
        const pool = exact.length > 0 ? exact : all;
        const pick = pickRandom(pool);
        if (!pick) {
          setError('No commanders matched that color filter.');
          return;
        }
        await selectByName(pick.name);
      } else {
        const names = await fetchAllCommanderNames();
        const filtered = names.filter((n) => !n.includes('//'));
        const pick = pickRandom(filtered);
        if (!pick) {
          setError('Could not load EDHREC commander list.');
          return;
        }
        await selectByName(pick);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Random pick failed');
    } finally {
      setRandomLoading(false);
    }
  };

  // ── Selected commander view ───────────────────────────────────────────
  if (value) {
    // Two-faced commanders (DFCs, MDFCs) keep their oracle text on the
    // card_faces array, not on the top-level card. Prefer the top-level
    // values; fall back to the front face. We don't try to render both
    // faces — that's reserved for the card preview modal.
    const front = value.card_faces?.[0];
    const manaCost = value.mana_cost ?? front?.mana_cost ?? '';
    const oracleText = value.oracle_text ?? front?.oracle_text ?? '';
    const power = value.power ?? front?.power;
    const toughness = value.toughness ?? front?.toughness;
    const loyalty = value.loyalty;
    return (
      <div className="commander-pick">
        <img
          className="commander-pick-art"
          src={
            value.image_uris?.normal ??
            value.card_faces?.[0]?.image_uris?.normal ??
            value.image_uris?.large ??
            value.image_uris?.art_crop ??
            value.card_faces?.[0]?.image_uris?.art_crop
          }
          alt=""
          aria-hidden="true"
        />
        <div className="commander-pick-body">
          <div className="commander-pick-headline">
            <span className="commander-pick-name">{value.name}</span>
            {manaCost && <ManaCost cost={manaCost} className="commander-pick-mana" />}
            {power && toughness && (
              <span className="commander-pick-stat">
                <span className="commander-pick-stat-value">
                  {power}/{toughness}
                </span>
              </span>
            )}
            {loyalty && (
              <span className="commander-pick-stat">
                <span className="commander-pick-stat-label">Loyalty</span>
                <span className="commander-pick-stat-value">{loyalty}</span>
              </span>
            )}
          </div>
          <div className="commander-pick-type">{value.type_line}</div>
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
            setLocalResults([]);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  // ── Search UI ─────────────────────────────────────────────────────────
  const dropdownVisible =
    open &&
    query.trim().length >= 2 &&
    (searchLoading || (ownedOnly ? localResults.length > 0 : results.length > 0));

  const resultList = (
    <ul
      className={`commander-search-results${isMobile ? ' commander-search-results--tray' : ''}`}
      role="listbox"
      // Mobile tray: dock just above the keyboard and cap height to the
      // visible viewport so the list never hides behind the keyboard.
      style={
        isMobile
          ? { bottom: keyboardInset, maxHeight: Math.round(viewportHeight * 0.55) }
          : undefined
      }
    >
      {searchLoading && <li className="commander-search-loading">Searching…</li>}
      {!ownedOnly &&
        results.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              className="commander-search-item"
              onMouseDown={(e) => {
                e.preventDefault();
                selectCard(card);
              }}
            >
              <span className="commander-search-item-name">{card.name}</span>
              <span className="commander-search-item-type">{card.type_line}</span>
            </button>
          </li>
        ))}
      {ownedOnly &&
        localResults.map((card) => (
          <li key={card.scryfallId}>
            <button
              type="button"
              className="commander-search-item"
              onMouseDown={(e) => {
                e.preventDefault();
                void selectByName(card.name);
              }}
            >
              <span className="commander-search-item-name">{card.name}</span>
              <span className="commander-search-item-type">
                {card.typeLine ?? 'Legendary Creature'}
              </span>
            </button>
          </li>
        ))}
    </ul>
  );

  // On phones the tray is portaled to <body> so it escapes any modal/overflow
  // ancestor and can pin to the viewport above the keyboard.
  const dropdown = !dropdownVisible
    ? null
    : isMobile
      ? createPortal(resultList, document.body)
      : resultList;

  return (
    <div className="commander-search">
      <input
        ref={inputRef}
        type="text"
        className="commander-search-input"
        placeholder={ownedOnly ? 'Search your commanders…' : 'Search for a commander…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        aria-label={ownedOnly ? 'Search your commanders' : 'Search for a commander'}
      />

      {/* Owned-only toggle — only visible if the collection has any legends. */}
      {(collectionLegends.length > 0 || ownedOnly) && (
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
              setResults([]);
              setLocalResults([]);
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
      )}

      {dropdown}

      {/* Suggestions section — only when the search box is empty. */}
      {query.trim().length === 0 && (
        <div className="commander-suggestions">
          <p className="commander-suggestions-label">
            {getColorFilterLabel(colorFilter)} commanders on EDHREC
            {ownedOnly ? ' (yours)' : ''}:
          </p>
          <div
            className="commander-color-filter"
            role="group"
            aria-label="Filter by color identity"
          >
            {COLORS.map((c) => {
              const active = colorFilter.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={`commander-color-pip${active ? ' active' : ''}`}
                  aria-pressed={active}
                  aria-label={COLOR_LABEL[c]}
                  title={COLOR_LABEL[c]}
                  onClick={() =>
                    setColorFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(c)) {
                        next.delete(c);
                      } else {
                        next.add(c);
                        // Colorless and the WUBRG colors are mutually exclusive —
                        // a colorless commander has no color identity.
                        if (c === 'C') {
                          for (const other of next) if (other !== 'C') next.delete(other);
                        } else {
                          next.delete('C');
                        }
                      }
                      return next;
                    })
                  }
                >
                  <i className={`ms ms-${c.toLowerCase()} ms-cost`} aria-hidden />
                </button>
              );
            })}
            {colorFilter.size > 0 && (
              <button
                type="button"
                className="commander-color-clear"
                onClick={() => setColorFilter(new Set())}
              >
                Clear
              </button>
            )}
          </div>

          {topLoading ? (
            <p className="commander-suggestions-empty">Loading…</p>
          ) : visibleTop.length === 0 ? (
            <p className="commander-suggestions-empty">
              {ownedOnly
                ? 'You don’t own any of EDHREC’s top commanders for that filter.'
                : 'No commanders found.'}
            </p>
          ) : (
            <ul className="commander-suggestion-chips">
              {visibleTop.slice(0, 12).map((c) => {
                const colors = c.colorIdentity.length > 0 ? c.colorIdentity : ['C'];
                return (
                  <li key={c.sanitized}>
                    <button
                      type="button"
                      className="commander-suggestion-chip"
                      onClick={() => void selectByName(c.name)}
                      disabled={searchLoading}
                    >
                      <span className="commander-suggestion-pips" aria-hidden>
                        {colors.map((color) => (
                          <i key={color} className={`ms ms-${color.toLowerCase()} ms-cost`} />
                        ))}
                      </span>
                      <span>{c.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="commander-surprise">
            <button
              type="button"
              className="commander-suggestion-chip commander-surprise-chip"
              onClick={handleSurpriseMe}
              disabled={
                randomLoading || searchLoading || (ownedOnly && collectionLegends.length === 0)
              }
            >
              <Shuffle
                className="commander-surprise-icon"
                width={14}
                height={14}
                strokeWidth={2}
                aria-hidden
              />
              {randomLoading ? 'Picking…' : 'Random'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="commander-search-error">{error}</p>}
    </div>
  );
}

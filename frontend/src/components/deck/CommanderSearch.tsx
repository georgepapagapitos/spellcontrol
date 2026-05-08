import { useEffect, useRef, useState } from 'react';
import { searchCommanders } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  value: ScryfallCard | null;
  onSelect: (card: ScryfallCard | null) => void;
}

export function CommanderSearch({ value, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const cards = await searchCommanders(query.trim());
        setResults(cards.slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  if (value) {
    return (
      <div className="commander-pick">
        <img
          className="commander-pick-art"
          src={value.image_uris?.art_crop ?? value.card_faces?.[0]?.image_uris?.art_crop}
          alt=""
          aria-hidden="true"
        />
        <div className="commander-pick-body">
          <div className="commander-pick-name">{value.name}</div>
          <div className="commander-pick-type">{value.type_line}</div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setResults([]);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="commander-search">
      <input
        type="text"
        className="commander-search-input"
        placeholder="Search for a commander…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && (results.length > 0 || loading) && (
        <ul className="commander-search-results" role="listbox">
          {loading && results.length === 0 && (
            <li className="commander-search-loading">Searching…</li>
          )}
          {results.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                className="commander-search-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(card);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span className="commander-search-item-name">{card.name}</span>
                <span className="commander-search-item-type">{card.type_line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

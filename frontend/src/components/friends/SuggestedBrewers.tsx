import './SuggestedBrewers.css';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { BrewerCard } from '../social/BrewerCard';
import { Button } from '../shared/Button';
import { SectionHeader } from '../shared/SectionHeader';
import { fetchBrewerRails, type BrewerCard as BrewerCardData } from '@/lib/brewers-client';
import { useOverflowEdges } from '@/lib/use-overflow-edges';

const LIMIT = 6;

/**
 * A short strip of brewers worth meeting, for someone whose Friends and
 * Following are nearly empty. People who share commanders with you lead
 * (signed in only; the server sends [] otherwise); the newest brewers fill in
 * when no one does. It is an insight surface, so it never displaces content
 * and never announces itself when it has nothing: a failed or empty rails
 * request renders nothing at all, with no error and no skeleton to shift the
 * page when it resolves empty.
 */
export function SuggestedBrewers() {
  const [brewers, setBrewers] = useState<BrewerCardData[] | null>(null);
  const track = useRef<HTMLUListElement>(null);
  useOverflowEdges(track, true, brewers?.length ?? 0);

  useEffect(() => {
    let cancelled = false;
    fetchBrewerRails()
      .then((rails) => {
        if (cancelled) return;
        const pool = rails.sharedCommanders.length > 0 ? rails.sharedCommanders : rails.newest;
        setBrewers(pool.slice(0, LIMIT));
      })
      .catch(() => {
        if (!cancelled) setBrewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brewers || brewers.length === 0) return null;
  return (
    <section className="suggested-brewers" aria-labelledby="suggested-brewers-title">
      <SectionHeader
        id="suggested-brewers-title"
        title="Brewers to meet"
        className="suggested-brewers-head"
        tools={
          <Button
            variant="link"
            to="/decks/discover/brewers"
            iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
          >
            See all
          </Button>
        }
      />
      <ul className="suggested-brewers-track" ref={track}>
        {brewers.map((b) => (
          <BrewerCard key={b.username} brewer={b} />
        ))}
      </ul>
    </section>
  );
}

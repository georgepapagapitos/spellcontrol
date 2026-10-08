import './SuggestedBrewers.css';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { BrewerCard } from '../social/BrewerCard';
import { Button } from '../shared/Button';
import { SectionHeader } from '../shared/SectionHeader';
import { fetchBrewerRails, type BrewerRails } from '@/lib/social/brewers-client';
import { useOverflowEdges } from '@/lib/util/use-overflow-edges';

const LIMIT = 6;

/**
 * A short strip of brewers worth meeting, for someone whose Friends and
 * Following are nearly empty. People who share commanders with you lead
 * (signed in only; the server sends [] otherwise); the newest brewers fill in
 * when no one does. People already in your circle (`known`: friends and
 * follows, by username) are left out of both pools, since they are not new to
 * meet. It is an insight surface, so it never displaces content
 * and never announces itself when it has nothing: a failed or empty rails
 * request renders nothing at all, with no error and no skeleton to shift the
 * page when it resolves empty.
 */
export function SuggestedBrewers({ known }: { known: ReadonlySet<string> }) {
  // The raw rails; the circle filter runs at render so a friend added while
  // the strip is up drops out of it.
  const [rails, setRails] = useState<BrewerRails | null>(null);
  const track = useRef<HTMLUListElement>(null);
  const shared = rails?.sharedCommanders.filter((b) => !known.has(b.username)) ?? [];
  const newest = rails?.newest.filter((b) => !known.has(b.username)) ?? [];
  const brewers = (shared.length > 0 ? shared : newest).slice(0, LIMIT);
  useOverflowEdges(track, true, brewers.length);

  useEffect(() => {
    let cancelled = false;
    fetchBrewerRails()
      .then((r) => {
        if (!cancelled) setRails(r);
      })
      .catch(() => {
        // An insight surface: a failed request renders nothing (rails stays null).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (brewers.length === 0) return null;
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

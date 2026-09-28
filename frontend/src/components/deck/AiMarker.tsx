import { Sparkles } from 'lucide-react';
import './AiMarker.css';

/**
 * The AI provenance pill (STYLE_GUIDE "AI-written content"). One component so
 * every surface carries the same sparkle + outline treatment — still muted,
 * never the accent: provenance is metadata, not a feature to celebrate.
 *
 * Its own file, with its own stylesheet, because it is mounted well beyond
 * the AI panels: RulesPage puts it on its title, and DeckCardRow puts it on
 * an "AI agrees" line (E274) inside chunks that never load the consent card
 * or the review panel. A marker that lived in DeckAiConsent.tsx dragged the
 * consent card's classes into those chunks (css-chunk-ownership test).
 */
export function AiMarker({ label = 'AI Beta' }: { label?: string }) {
  return (
    <span className="deck-ai-marker">
      <Sparkles width={12} height={12} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Persistable synergy analysis: the lean, deck-storable summary the UI renders —
 * the engine headline, lopsided-engine warnings, per-axis producer/payoff counts,
 * and the off-meta suggestions. Holds names + primitives only (no ScryfallCards)
 * so it can live on the deck in IndexedDB without bloating it.
 */
import type { DeckSynergy } from './deckSynergy';
import { suggestOffMeta, type SynergyCandidate, type SynergySuggestion } from './suggest';
import type { AxisKey } from './axes';

export interface SynergyAxisView {
  axis: AxisKey;
  label: string;
  producers: number;
  payoffs: number;
}

export interface SynergyAnalysis {
  /** e.g. "Primary engine: Tokens / go-wide (10 producers / 8 payoffs)." */
  headline: string;
  /** Lopsided-engine notes, e.g. "Tokens: 9 producers but no payoff…". */
  warnings: string[];
  /** Busiest axes with counts (for a compact balance readout). */
  axes: SynergyAxisView[];
  /** Off-meta cards that fill the deck's engine gaps, each with a reason. */
  suggestions: SynergySuggestion[];
}

const MAX_AXES_SHOWN = 6;

/** Compose the persistable analysis from an already-computed DeckSynergy. */
export function buildSynergyAnalysis(
  deck: DeckSynergy,
  candidates: SynergyCandidate[]
): SynergyAnalysis {
  return {
    headline: deck.headline,
    warnings: deck.warnings,
    axes: deck.axes.slice(0, MAX_AXES_SHOWN).map((a) => ({
      axis: a.axis,
      label: a.label,
      producers: a.producers.length,
      payoffs: a.payoffs.length,
    })),
    suggestions: suggestOffMeta(deck, candidates),
  };
}

export type { SynergyCandidate, SynergySuggestion };

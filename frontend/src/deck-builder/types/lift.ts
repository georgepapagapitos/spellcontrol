// EDHREC card-page lift types, split out of types/index.ts (file-size ratchet).

// A card-page "lift" co-play entry — how strongly a card is played alongside
// a given seed card, derived from EDHREC's per-card page (highliftcards /
// topcards). See services/edhrec/client.ts (parseCardLiftPool) for the
// derivation and services/deckBuilder/liftSynergy.ts for how it's scored.
export interface LiftEntry {
  name: string;
  lift: number;
  coPlayPct: number; // integer 0-100, derived inclusion/potential_decks
  numDecks: number;
  potentialDecks: number;
  lowSample: boolean; // numDecks < 50 (strict floor)
}

/**
 * A generation-time "hidden synergy" suggestion surfaced from EDHREC card-page
 * lift data (see services/deckBuilder/deckGeneration/phaseLiftPicks.ts) — a
 * package pick the generator did NOT add to the deck, only proposed. `kind`
 * distinguishes a single strong co-play pairing ('bomb') from a candidate
 * lifted by several deck cards at once ('cluster'); `liftedBy` names the
 * seed(s) responsible, capped to 3, strongest first.
 */
export interface LiftPackagePick {
  name: string;
  kind: 'bomb' | 'cluster';
  liftedBy: string[];
  lowSample: boolean;
  owned: boolean;
}

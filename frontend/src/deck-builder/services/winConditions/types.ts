/**
 * Types for win-condition detection. Pure — no DOM, no network.
 */

export type WinConCategory =
  | 'infinite-combo'
  | 'alt-win'
  | 'mill'
  | 'poison'
  | 'go-wide'
  | 'aristocrats'
  | 'burn'
  | 'voltron'
  | 'combat'
  | 'none';

/**
 * One way a win path assembles: drawing `need` distinct cards from `names`.
 * Each category declares its own commitment bar (mirroring the detector's
 * qualification gates) — a combo needs every library piece of one loop, an
 * alt-win needs any single finisher, a strategic plan needs the same critical
 * mass the detector required to call it a plan at all.
 */
export interface AssemblyOption {
  /** Library card names that advance this option. Commanders are excluded —
   *  they start in the command zone, never the library. */
  names: string[];
  /** Distinct `names` that must be drawn for the path to count as assembled. */
  need: number;
}

export interface WinCondition {
  category: WinConCategory;
  label: string;
  /** Short human-readable summary of how the deck wins via this path. */
  summary: string;
  /** Card names that are evidence for this win condition. */
  evidence: string[];
  /**
   * Confidence score — higher = more evidence / stronger signal. Used only for
   * internal ranking; not exposed to UI directly.
   */
  score: number;
  /**
   * Assembly-clock inputs — the path is "assembled" once ANY one option is
   * satisfied (see {@link AssemblyOption}). Absent for paths with no discrete
   * assembly (generic combat) and on analyses persisted before this field
   * existed (the engine-version bump recomputes those).
   */
  assembly?: AssemblyOption[];
}

export interface WinConditionAnalysis {
  /** Primary win path (highest scoring), or null if nothing exceeded threshold. */
  primary: WinCondition | null;
  /** Secondary paths (ranked descending). Empty when there's only one or none. */
  secondary: WinCondition[];
  /** True when no path scored above the detection threshold. */
  noClearWinCondition: boolean;
  /**
   * Non-land tutors in the deck — assembly-clock wildcards. A drawn tutor
   * fetches a missing piece, so it counts toward any assembly option; without
   * this the simulated clock for tutor-reliant decks (combo especially) reads
   * absurdly slow, which is the raw math but not how the deck plays.
   */
  tutors?: string[];
}

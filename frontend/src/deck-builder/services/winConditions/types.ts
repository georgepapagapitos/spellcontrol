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
}

export interface WinConditionAnalysis {
  /** Primary win path (highest scoring), or null if nothing exceeded threshold. */
  primary: WinCondition | null;
  /** Secondary paths (ranked descending). Empty when there's only one or none. */
  secondary: WinCondition[];
  /** True when no path scored above the detection threshold. */
  noClearWinCondition: boolean;
}

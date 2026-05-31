import type { CardTally } from './useCardCarousel';

/** Per-CMC color split for the stacked "by color" curve. 0 colors → colorless,
 *  exactly 1 → that color, 2+ → gold (multicolor). */
export interface CurveColorBucket {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  gold: number;
  colorless: number;
}

export interface DeckManaData {
  manaCurve: Record<number, number>;
  /** Per-CMC color breakdown powering the stacked curve (omit → count-only). */
  curveByColor?: Record<number, CurveColorBucket>;
  averageCmc: number;
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: {
    counts: Record<string, number>;
    total: number;
    /** Per-color mana sources, deduped by name with copy counts — powers the
     *  "show me the N sources of White" drill-down in DeckColorPanel. */
    sourcesByColor?: Record<string, CardTally[]>;
  };
  typeBreakdown: Record<string, number>;
  /** Per-bucket card lists for the tap-to-preview drill-downs. Each maps a
   *  bucket (CMC / type / color) to its deduped cards. */
  cardsByCmc?: Record<number, CardTally[]>;
  cardsByType?: Record<string, CardTally[]>;
  cardsByColor?: Record<string, CardTally[]>;
}

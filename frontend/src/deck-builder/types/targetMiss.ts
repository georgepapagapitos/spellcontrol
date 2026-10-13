/** A number the user asked for that the finished deck missed (E1006). Computed
 *  late from the deck-invariant checker, so one channel covers every target
 *  instead of a bespoke note per miss. */
export interface TargetMiss {
  key: 'nonbasic' | 'lands' | 'budget' | 'owned';
  asked: number;
  got: number;
  /** What actually happened, as a clause. Null when the
   *  deck cannot say. */
  cause: string | null;
  /** Money amounts only. */
  currency?: 'USD' | 'EUR';
}

/** Carried by both the generated deck and its build report. */
export interface TargetMissFields {
  /** Every user target the deck missed, shown first (E1006). */
  targetMisses?: TargetMiss[];
}

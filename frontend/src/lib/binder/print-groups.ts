import type { Finish } from '@/types';

/** The card fields a printable checklist row is built from. */
interface PrintCard {
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
}

export interface PrintRow {
  /** Unique within a section: name | set | number | finish. */
  key: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  qty: number;
}

/**
 * Rolls a section's copies into checklist rows, one per printing AND finish.
 * A foil and a nonfoil of one printing are different lines to pull, so they
 * must not share a row (or a React key).
 */
export function groupPrintRows(cards: readonly PrintCard[]): PrintRow[] {
  const rows = new Map<string, PrintRow>();
  for (const card of cards) {
    const key = `${card.name}|${card.setCode}|${card.collectorNumber}|${card.finish}`;
    const existing = rows.get(key);
    if (existing) existing.qty += 1;
    else
      rows.set(key, {
        key,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        qty: 1,
      });
  }
  return [...rows.values()];
}

/** The marker printed beside a non-default finish; nonfoil is the unmarked norm. */
export function printFinishLabel(finish: Finish): string | null {
  return finish === 'foil' ? 'Foil' : finish === 'etched' ? 'Etched' : null;
}

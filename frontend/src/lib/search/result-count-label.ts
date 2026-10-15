/**
 * "14 decks", "1 deck", "No decks match"; `more` marks a count that is only the
 * pages loaded so far ("24+ decks").
 */
export function resultCountLabel(n: number, noun: string, more = false): string {
  if (n === 0) return `No ${noun}s match`;
  return `${n.toLocaleString()}${more ? '+' : ''} ${n === 1 && !more ? noun : `${noun}s`}`;
}

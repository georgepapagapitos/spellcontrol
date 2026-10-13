import { BRACKET_ESTIMATOR_VERSION, type BracketEstimation } from '@spellcontrol/deck-metrics';
import { apiUrl } from '@/lib/api/api-base';
import { handleResponse } from '@/lib/api/fetch-utils';

/** Mirrors backend/src/routes/bracket-votes.ts NOTE_MAX. */
export const BRACKET_NOTE_MAX = 280;

export interface BracketVote {
  vote: 'agree' | 'disagree';
  statedBracket: number;
  estimatedBracket: number;
  note: string;
}

/**
 * A fingerprint of the card list an estimate was made from: the commanders and
 * the mainboard by name and count, order-free. The same list hashes the same,
 * so a re-vote updates the label and an edited list starts a new one.
 */
export function deckListText(
  commanders: readonly (string | undefined)[],
  mainboardNames: readonly string[]
): string {
  const counts = new Map<string, number>();
  for (const n of mainboardNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [
    ...commanders.filter((n): n is string => !!n).map((n) => `C ${n}`),
    ...[...counts].map(([n, c]) => `${c} ${n}`),
  ]
    .sort()
    .join('\n');
}

/** SHA-256 of `deckListText`, as lowercase hex. */
export async function deckFingerprint(listText: string): Promise<string> {
  const bytes = new TextEncoder().encode(listText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchBracketVote(
  deckId: string,
  deckHash: string
): Promise<BracketVote | null> {
  const qs = new URLSearchParams({ deckId, deckHash });
  const res = await fetch(apiUrl(`/api/bracket-votes?${qs}`), { credentials: 'include' });
  const body = await handleResponse<{ vote: BracketVote | null }>(res);
  return body.vote;
}

export async function sendBracketVote(input: {
  deckId: string;
  deckHash: string;
  estimation: BracketEstimation;
  statedBracket: number;
  note: string;
}): Promise<BracketVote> {
  const { estimation } = input;
  const res = await fetch(apiUrl('/api/bracket-votes'), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deckId: input.deckId,
      deckHash: input.deckHash,
      estimatorVersion: BRACKET_ESTIMATOR_VERSION,
      estimatedBracket: estimation.bracket,
      signals: {
        softScore: estimation.softScore,
        hardFloors: estimation.hardFloors.map((f) => ({ bracket: f.bracket, reason: f.reason })),
        breakdown: estimation.breakdown,
      },
      statedBracket: input.statedBracket,
      vote: input.statedBracket === estimation.bracket ? 'agree' : 'disagree',
      note: input.note,
    }),
  });
  const body = await handleResponse<{ vote: BracketVote }>(res);
  return body.vote;
}

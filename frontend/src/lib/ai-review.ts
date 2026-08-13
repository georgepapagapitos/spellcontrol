import { authedFetch, handleResponse } from './fetch-utils';
import type { DeckAnalysisResult } from './deck-analysis';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Client for the opt-in AI deck review (T96 "Read the deck"). Consent and
 * quota are enforced server-side; this module only assembles payloads and
 * reads state. A 404 from any endpoint means the feature is not configured
 * on the backend at all — callers render nothing.
 */

export interface AiStatus {
  optIn: boolean;
  used: number;
  limit: number;
}

export interface DeckReviewResult {
  content: string;
  cached: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DeckReviewPayload {
  deckId: string;
  commander: string;
  cards: { name: string; oracleId: string; qty: number }[];
  analysis: DeckAnalysisResult;
}

/** null = feature unavailable (backend key absent) or caller unauthenticated. */
export async function fetchAiStatus(): Promise<AiStatus | null> {
  const res = await authedFetch('/api/ai/status', { method: 'GET' });
  if (res.status === 404 || res.status === 401) return null;
  return handleResponse<AiStatus>(res);
}

export async function setAiOptIn(enabled: boolean): Promise<boolean> {
  const res = await authedFetch('/api/ai/opt-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const data = await handleResponse<{ optIn: boolean }>(res);
  return data.optIn;
}

export async function requestDeckReview(payload: DeckReviewPayload): Promise<DeckReviewResult> {
  const res = await authedFetch('/api/ai/deck-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<DeckReviewResult>(res);
}

/** Aggregate per-slot deck rows into the name/oracleId/qty list the API takes. */
export function buildDeckReviewCards(
  mainboard: { card: ScryfallCard }[]
): DeckReviewPayload['cards'] {
  const byName = new Map<string, { name: string; oracleId: string; qty: number }>();
  for (const { card } of mainboard) {
    const existing = byName.get(card.name);
    if (existing) {
      existing.qty += 1;
    } else {
      byName.set(card.name, { name: card.name, oracleId: card.oracle_id ?? '', qty: 1 });
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Local staleness key: the review shown is stale exactly when the deck's
 * current content key differs from the key captured at request time. Content
 * only — commander plus name×qty — so an edit that is later reverted reads
 * as fresh again (an edit counter would not).
 */
export function deckContentKey(commander: string, cards: { name: string; qty: number }[]): string {
  const parts = [...cards]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => `${c.name}×${c.qty}`);
  return `${commander}::${parts.join('|')}`;
}

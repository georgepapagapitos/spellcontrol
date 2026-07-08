import { apiUrl } from './api-base';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Client for the Feedback Tool (BlueprintMTG-style). A deck owner mints a
 * kind='feedback' share; recipients open it at /s/:token, propose adds/cuts
 * plus a comment and a power-bracket read, and submit here — signed in or as
 * a guest. The owner lists responses per deck and records a verdict per
 * suggestion; the deck edit itself happens through the normal deck store so
 * it syncs like any other change. Mirrors backend/src/routes/feedback.ts.
 */

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface FeedbackSuggestion {
  id: string;
  type: 'add' | 'cut';
  cardName: string;
  scryfallId?: string;
  oracleId?: string;
  imageUrl?: string;
  /** Full Scryfall card for adds — lets the owner apply without a lookup. */
  card?: ScryfallCard;
  status: SuggestionStatus;
}

/** A suggestion as drafted client-side, before the server assigns id/status. */
export interface DraftSuggestion {
  type: 'add' | 'cut';
  cardName: string;
  scryfallId?: string;
  oracleId?: string;
  imageUrl?: string;
  card?: ScryfallCard;
}

export interface FeedbackResponse {
  id: string;
  authorName: string;
  authorUserId: string | null;
  comment: string;
  bracketSuggestion: number | null;
  suggestions: FeedbackSuggestion[];
  createdAt: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Submit a feedback response against a feedback share token. */
export async function submitFeedback(
  token: string,
  input: {
    authorName?: string;
    comment?: string;
    bracketSuggestion?: number | null;
    suggestions: DraftSuggestion[];
  }
): Promise<{ id: string }> {
  const res = await fetch(apiUrl(`/api/feedback/public/${encodeURIComponent(token)}`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to submit feedback.'));
  }
  const body = (await res.json()) as { feedback: { id: string } };
  return body.feedback;
}

/** List feedback responses for one of the caller's decks, newest first. */
export async function listDeckFeedback(deckId: string): Promise<FeedbackResponse[]> {
  const res = await fetch(apiUrl(`/api/feedback/deck/${encodeURIComponent(deckId)}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load feedback.'));
  }
  const body = (await res.json()) as { responses: FeedbackResponse[] };
  return body.responses;
}

/** Record the owner's verdict on one suggestion. */
export async function setSuggestionStatus(
  feedbackId: string,
  suggestionId: string,
  status: SuggestionStatus
): Promise<void> {
  const res = await fetch(
    apiUrl(
      `/api/feedback/${encodeURIComponent(feedbackId)}/suggestions/${encodeURIComponent(suggestionId)}`
    ),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to update suggestion.'));
  }
}

/** Delete a whole feedback response (owner only). */
export async function deleteFeedback(feedbackId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/feedback/${encodeURIComponent(feedbackId)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to delete feedback.'));
  }
}

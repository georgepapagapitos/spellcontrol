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

/**
 * Ask for the review and read it as it is written.
 *
 * The wire is NDJSON (see `backend/src/routes/ai.ts`): `{delta}` lines carry
 * prose in order for live display, one `{done}` line terminates and carries the
 * authoritative full text, and `{error}` reports a failure that happened after
 * the 200 already went out. `onText` receives the text accumulated so far, so a
 * caller can drop it straight into state.
 *
 * The returned `content` is the one from `{done}`, never the deltas glued back
 * together — what's displayed is then exactly what the server stored. A stream
 * that ends without `{done}` was truncated: a failure, not half a review to
 * present as finished.
 */
export async function requestDeckReview(
  payload: DeckReviewPayload,
  onText?: (textSoFar: string) => void
): Promise<DeckReviewResult> {
  const res = await authedFetch('/api/ai/deck-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Anything that fails before the first byte still answers with a status code
  // and a JSON body; handleResponse always throws for those.
  if (!res.ok) await handleResponse<never>(res);

  let content = '';
  let done: DeckReviewResult | undefined;
  let failure: string | undefined;

  const readLine = (line: string) => {
    if (!line.trim()) return;
    let msg: { delta?: unknown; done?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      // A mangled frame means the rest of the stream can't be trusted either.
      throw new Error('The review came back garbled. Try again.');
    }
    if (typeof msg.delta === 'string') {
      content += msg.delta;
      onText?.(content);
    } else if (typeof msg.error === 'string') {
      failure = msg.error;
    } else if (msg.done && typeof msg.done === 'object') {
      done = msg.done as DeckReviewResult;
    }
  };

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        readLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    readLine(buffer);
  } else {
    // No readable stream (a test double, or a runtime without one): the body is
    // the same NDJSON, it just arrives all at once.
    for (const line of (await res.text()).split('\n')) readLine(line);
  }

  if (failure) throw new Error(failure);
  if (!done) throw new Error('The review ended early. Try again.');
  return done;
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

export interface ReviewSection {
  /** Stable id — also the CSS/test hook. */
  id: 'weakness' | 'gameplan' | 'win';
  title: string;
  paragraphs: string[];
}

/**
 * Split the review prose into its three titled sections, in DISPLAY order —
 * weakness first, because that's the part statistics can't give you.
 *
 * The prompt fixes the writing order (gameplan → how it wins → the weakness)
 * and asks for 3-4 paragraphs with no headers, so the mapping is positional:
 * first paragraph is the gameplan, last is the weakness, anything between is
 * the win path. Anything shorter than three paragraphs isn't the shape we can
 * label honestly — returns null, and the caller renders plain prose.
 */
export function splitReviewSections(content: string): ReviewSection[] | null {
  const paras = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length < 3) return null;
  return [
    { id: 'weakness', title: 'The weakness that matters', paragraphs: [paras[paras.length - 1]] },
    { id: 'gameplan', title: 'The gameplan', paragraphs: [paras[0]] },
    { id: 'win', title: 'How it wins', paragraphs: paras.slice(1, -1) },
  ];
}

export interface ProseToken {
  text: string;
  /** Canonical deck card name when this run is a card mention. */
  card?: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split a paragraph into plain-text runs and card-name mentions, so the names
 * can render as tappable chips. The model is instructed to reference only
 * cards that appear in the decklist, so exact-name matching is reliable.
 *
 * Longest name first, so "Kaalia of the Vast" wins over a shorter list-mate it
 * contains. A double-faced card also matches on its front face alone (the
 * model writes "Delver of Secrets", not the `//` name) but always reports the
 * canonical full name, which is what the deck is keyed by. Boundaries are
 * non-word only, so a possessive ("Kaalia's trigger") still chips the name.
 */
export function tokenizeCardNames(text: string, deckCardNames: string[]): ProseToken[] {
  const canonical = new Map<string, string>();
  for (const name of deckCardNames) {
    canonical.set(name.toLowerCase(), name);
    const front = name.split(' // ')[0];
    if (front !== name) canonical.set(front.toLowerCase(), name);
  }
  const matchable = [...canonical.keys()].sort((a, b) => b.length - a.length);
  if (matchable.length === 0) return [{ text }];

  const re = new RegExp(`(?<!\\w)(${matchable.map(escapeRegExp).join('|')})(?!\\w)`, 'gi');
  const tokens: ProseToken[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) tokens.push({ text: text.slice(last, at) });
    tokens.push({ text: m[0], card: canonical.get(m[0].toLowerCase()) });
    last = at + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
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

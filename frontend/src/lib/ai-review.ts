import { authedFetch, handleResponse } from './fetch-utils';
import { readNdjson } from './ndjson';
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

  await readNdjson(res, (msg) => {
    if (typeof msg.delta === 'string') {
      content += msg.delta;
      onText?.(content);
    } else if (typeof msg.error === 'string') {
      failure = msg.error;
    } else if (msg.done && typeof msg.done === 'object') {
      done = msg.done as DeckReviewResult;
    }
  });

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
  /** False while this section is still being streamed into. */
  complete: boolean;
}

/** The three labels prompt v4 emits, in emission order (also display order). */
export const WEAKNESS_MARK = '---WEAKNESS---';
export const GAMEPLAN_MARK = '---GAMEPLAN---';
export const WINS_MARK = '---WINS---';

const SECTION_SPECS = [
  { id: 'weakness', mark: WEAKNESS_MARK, title: 'The weakness that matters' },
  { id: 'gameplan', mark: GAMEPLAN_MARK, title: 'The gameplan' },
  { id: 'win', mark: WINS_MARK, title: 'How it wins' },
] as const;

/**
 * Split the review prose into its three titled sections.
 *
 * **Works on a partial stream**, which is the whole point: the panel renders
 * all three titled blocks from the first byte and each one fills in place, so
 * nothing ever reflows when the stream ends. Prompt v4 emits the labels and
 * puts the weakness first, so emission order and display order agree and no
 * block waits on a later one.
 *
 * `complete` marks a section whose text is finished — a later label has been
 * seen, or the stream is done. Callers use it to decide when card-name chips
 * are safe to apply, since chipping a half-typed name would jitter the line.
 *
 * Returns null when no label has appeared at all (an older cached review from
 * prompt v3, or a model that ignored the format) — the caller falls back to
 * plain paragraphs, which is exactly the pre-v4 rendering.
 */
export function splitReviewSections(content: string, streaming = false): ReviewSection[] | null {
  const found = SECTION_SPECS.map((spec) => ({ spec, at: content.indexOf(spec.mark) })).filter(
    (f) => f.at !== -1
  );
  if (found.length === 0) return null;
  found.sort((a, b) => a.at - b.at);

  const sections: ReviewSection[] = [];
  for (const spec of SECTION_SPECS) {
    const hit = found.find((f) => f.spec.id === spec.id);
    const idx = found.findIndex((f) => f.spec.id === spec.id);
    const body =
      hit === undefined
        ? ''
        : content
            .slice(
              hit.at + spec.mark.length,
              idx < found.length - 1 ? found[idx + 1].at : undefined
            )
            .trim();
    sections.push({
      id: spec.id,
      title: spec.title,
      paragraphs: body
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean),
      // The last label seen is still being written while the stream is open.
      complete: !streaming || (hit !== undefined && idx < found.length - 1),
    });
  }
  return sections;
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

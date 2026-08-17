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
  /**
   * Cards the review looked up while writing — the ones it is recommending.
   * Chips are matched against the decklist, and a recommended card is by
   * definition NOT in the decklist, so without this the cards the reading is
   * actually telling you to add are the only ones you cannot tap. Absent on
   * readings stored before the server sent it: chip the deck alone then,
   * rather than reading absence as "it looked nothing up".
   */
  fetched?: string[];
}

/**
 * Exactly the fields `backend/src/ai/deck-review.ts`'s `renderAnalysis` reads
 * off `DeckAnalysisResult`, plus the optional bracket target/estimate (also
 * read there). Everything else — role ranges/status/message/contributingSlotIds,
 * curve verdict/message/peak, colorIdentity, taggerReady, sizeDelta — is
 * server-discarded, so it never leaves the browser. `roles[].contributingSlotIds`
 * was the worst offender: several KB of `slot_<uuid>` strings per request, and
 * (since the whole analysis object is the cache key) cosmetic slot-id churn was
 * silently invalidating cached reviews.
 */
export interface AiAnalysisPayload {
  totalNonCommander: number;
  types: {
    lands: number;
    creatures: number;
    instants: number;
    sorceries: number;
    artifacts: number;
    enchantments: number;
    planeswalkers: number;
    battles: number;
  };
  curve: {
    averageCmc: number;
    buckets: { cmc: number; count: number }[];
  };
  roles: { label: string; count: number }[];
  /** Omitted entirely when both are absent. */
  bracket?: { target: number | null; estimate: number | null };
}

/** Project a full `DeckAnalysisResult` down to what the AI prompt reads. */
export function toAiAnalysis(
  analysis: DeckAnalysisResult,
  bracket?: { target: number | null; estimate: number | null }
): AiAnalysisPayload {
  const payload: AiAnalysisPayload = {
    totalNonCommander: analysis.totalNonCommander,
    types: {
      lands: analysis.types.lands,
      creatures: analysis.types.creatures,
      instants: analysis.types.instants,
      sorceries: analysis.types.sorceries,
      artifacts: analysis.types.artifacts,
      enchantments: analysis.types.enchantments,
      planeswalkers: analysis.types.planeswalkers,
      battles: analysis.types.battles,
    },
    curve: {
      averageCmc: analysis.curve.averageCmc,
      buckets: analysis.curve.buckets.map((b) => ({ cmc: b.cmc, count: b.count })),
    },
    roles: analysis.roles.map((r) => ({ label: r.label, count: r.count })),
  };
  if (bracket && (bracket.target != null || bracket.estimate != null)) {
    payload.bracket = bracket;
  }
  return payload;
}

export interface DeckReviewPayload {
  deckId: string;
  commander: string;
  cards: { name: string; oracleId: string; qty: number }[];
  analysis: AiAnalysisPayload;
}

/** null = feature unavailable (backend key absent) or caller unauthenticated. */
export async function fetchAiStatus(): Promise<AiStatus | null> {
  const res = await authedFetch('/api/ai/status', { method: 'GET' });
  if (res.status === 404 || res.status === 401) return null;
  return handleResponse<AiStatus>(res);
}

export interface ReviewReading {
  id: string;
  content: string;
  model: string;
  createdAt: number;
  /** See {@link DeckReviewResult.fetched}. Absent on pre-column rows. */
  fetched?: string[];
}

/**
 * Past readings for one deck, newest first. A DB read of the user's own
 * generated content — free, spends no quota, never touches the model. Rows
 * written before the server learned deck ids aren't listed, so history starts
 * from that deploy forward. Unavailable (404/401) degrades to "no history".
 */
export async function fetchReviewHistory(deckId: string): Promise<ReviewReading[]> {
  const res = await authedFetch(`/api/ai/history?deckId=${encodeURIComponent(deckId)}`, {
    method: 'GET',
  });
  if (res.status === 404 || res.status === 401) return [];
  const data = await handleResponse<{ readings: ReviewReading[] }>(res);
  return data.readings ?? [];
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
 * Markdown emphasis the model sometimes writes around a card name, stripped for
 * display. Nothing renders markdown here — the prose goes into `<p>` as text —
 * so `**Extraordinary Journey**` reached the reader with the asterisks showing.
 *
 * Measured across 70 live runs: v8 emitted `**` in 7/35, prompt v9 in **18/35**,
 * because telling the model to name cards prominently made it bold them. A
 * prompt rule could ask it to stop, but that is a request the model can ignore
 * on any given run; stripping at the render boundary is not. Only the doubled
 * marker is removed — a lone asterisk is left alone, since MTG text uses it in
 * variable power/toughness.
 */
export function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '');
}

/**
 * Short forms a legend is referred to by, mapped back to its full name.
 *
 * The model writes "Teferi", "Ioreth", "Vizier" and "Captain America" for cards
 * whose printed names are far longer, and exact-name matching left exactly
 * those as dead text beside chipped neighbours — the reader sees an arbitrary
 * half of the names light up. Both standard legend shapes are covered:
 * `Name, Title` and `Name of Place`.
 *
 * Three guards, because a short form is a much blunter instrument than a full
 * name:
 * - **Ambiguous prefixes are dropped.** Two Teferis in one deck means "Teferi"
 *   identifies neither.
 * - **Never shadows a real card name.** A prefix that is itself somebody's full
 *   name stays that card.
 * - **Must be capitalised where it appears** (enforced at match time) and at
 *   least 4 characters. Without this, "Will, Scion of Peace" turns every "will"
 *   in the prose into a chip.
 */
function shortForms(canonical: Map<string, string>): Map<string, string> {
  const counts = new Map<string, Set<string>>();
  for (const full of new Set(canonical.values())) {
    const cut = full.search(/,| of /);
    if (cut < 0) continue;
    const alias = full.slice(0, cut).trim();
    if (alias.length < 4 || canonical.has(alias.toLowerCase())) continue;
    const seen = counts.get(alias.toLowerCase()) ?? new Set<string>();
    seen.add(full);
    counts.set(alias.toLowerCase(), seen);
  }
  const out = new Map<string, string>();
  for (const [key, fulls] of counts) if (fulls.size === 1) out.set(key, [...fulls][0]);
  return out;
}

/**
 * Split a paragraph into plain-text runs and card-name mentions, so the names
 * can render as tappable chips.
 *
 * `matchNames` is the deck's cards PLUS the cards the model looked up while
 * writing (`DeckReviewResult.fetched`). Both are exact, server-vouched names,
 * so exact matching stays reliable — and the prescription's recommendations,
 * which are absent from the decklist by construction, become tappable too.
 * A name the model invented is in neither list and simply gets no chip, which
 * is the belt-and-braces that has always been here.
 *
 * Longest name first, so "Kaalia of the Vast" wins over a shorter list-mate it
 * contains. A double-faced card also matches on its front face alone (the
 * model writes "Delver of Secrets", not the `//` name) but always reports the
 * canonical full name, which is what the deck is keyed by. Boundaries are
 * non-word only, so a possessive ("Kaalia's trigger") still chips the name.
 *
 * Legends also match on their short form — see {@link shortForms} — because the
 * model writes "Teferi" and "Vizier" as readily as the printed name, and the
 * reader cannot tell why half the names in a sentence are tappable.
 */
export function tokenizeCardNames(text: string, matchNames: string[]): ProseToken[] {
  const canonical = new Map<string, string>();
  for (const name of matchNames) {
    canonical.set(name.toLowerCase(), name);
    const front = name.split(' // ')[0];
    if (front !== name) canonical.set(front.toLowerCase(), name);
  }
  const aliases = shortForms(canonical);
  for (const [key, full] of aliases) canonical.set(key, full);

  const matchable = [...canonical.keys()].sort((a, b) => b.length - a.length);
  if (matchable.length === 0) return [{ text }];

  const re = new RegExp(`(?<!\\w)(${matchable.map(escapeRegExp).join('|')})(?!\\w)`, 'gi');
  const tokens: ProseToken[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const key = m[0].toLowerCase();
    // A short form only counts when it is capitalised as written: "Will" is a
    // card, "will" is a verb, and the alternation above is case-insensitive.
    if (aliases.has(key) && m[0][0] !== m[0][0].toUpperCase()) continue;
    if (at > last) tokens.push({ text: text.slice(last, at) });
    tokens.push({ text: m[0], card: canonical.get(key) });
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

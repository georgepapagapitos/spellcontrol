import { authedFetch, handleResponse } from './fetch-utils';
import { readNdjson } from './ndjson';

/**
 * Client for the AI rules Q&A (E261, "Ask a judge"). Same contract as the deck
 * review client (`ai-review.ts`): consent and quota are enforced server-side,
 * the wire is NDJSON over chunked HTTP, and a stream that ends without `{done}`
 * is a failure — never a short answer to present as finished.
 */

/** A Comprehensive Rules citation, resolved to its official text server-side. */
export interface CitedRule {
  ref: string;
  text: string;
}

export interface RulesAnswer {
  content: string;
  cached: boolean;
  /** Every rule the answer cites, with its official text, in citation order. */
  rules: CitedRule[];
  /** Cards the model looked up while answering — the tappable card names. */
  fetched?: string[];
  truncated?: boolean;
}

export interface RulesQuestionEntry {
  id: string;
  question: string;
  content: string;
  createdAt: number;
  rules: CitedRule[];
  fetched?: string[];
}

export interface RulesHistory {
  /** The rules document's own effective date ("August 7, 2026"), if known. */
  effectiveDate: string | null;
  questions: RulesQuestionEntry[];
}

/**
 * Ask the question and read the answer as it is written. `onText` receives the
 * prose accumulated so far. The returned `content` is `{done}`'s authoritative
 * copy, never the deltas glued back together.
 */
export async function requestRulesAnswer(
  question: string,
  onText?: (textSoFar: string) => void
): Promise<RulesAnswer> {
  const res = await authedFetch('/api/ai/rules-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) await handleResponse<never>(res);

  let content = '';
  let done: RulesAnswer | undefined;
  let failure: string | undefined;

  await readNdjson(res, (msg) => {
    if (typeof msg.delta === 'string') {
      content += msg.delta;
      onText?.(content);
    } else if (typeof msg.error === 'string') {
      failure = msg.error;
    } else if (msg.done && typeof msg.done === 'object') {
      done = msg.done as RulesAnswer;
    }
  });

  if (failure) throw new Error(failure);
  if (!done) throw new Error('The answer ended early. Try again.');
  return done;
}

/**
 * Past questions, newest first — a DB read of the user's own content: free,
 * spends no quota, never touches the model. Unavailable (404/401) degrades to
 * an empty history so the page can still render its ask box states.
 */
export async function fetchRulesHistory(): Promise<RulesHistory> {
  const res = await authedFetch('/api/ai/rules-history', { method: 'GET' });
  if (res.status === 404 || res.status === 401) return { effectiveDate: null, questions: [] };
  const data = await handleResponse<RulesHistory>(res);
  return { effectiveDate: data.effectiveDate ?? null, questions: data.questions ?? [] };
}

/**
 * Split the answer prose into runs, marking each cited rule number so it can
 * render as a tappable citation. Only refs the server verified (they arrived
 * with official text) become interactive — an unverified number stays plain
 * prose, the same way a hallucinated card name gets no chip.
 */
export interface RuleRun {
  text: string;
  /** Set when this run is a citation of a verified rule. */
  ref?: string;
}

export function tokenizeRuleRefs(text: string, verified: readonly string[]): RuleRun[] {
  if (verified.length === 0) return [{ text }];
  const known = new Set(verified);
  const runs: RuleRun[] = [];
  let last = 0;
  for (const m of text.matchAll(/\b\d{3}\.\d+[a-z]*\b/g)) {
    if (!known.has(m[0])) continue;
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    runs.push({ text: m[0], ref: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

import Anthropic from '@anthropic-ai/sdk';

/**
 * Thin Anthropic client for the opt-in AI features (T96 "Read the deck").
 * The single `messages.create` call site — everything else (prompt assembly,
 * caching, quota) lives in tested modules. Coverage-excluded alongside the
 * other thin API clients.
 *
 * Tier is a one-string change here; re-run the eval suite before changing it.
 */
export const AI_MODEL = 'claude-haiku-4-5';

/** Key absent → the whole feature is off: routes 404, no UI renders. */
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;

export interface AiGeneration {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One generation, streamed. `onDelta` fires per text chunk so the route can
 * forward it to the client while the model is still writing (T102 — measured
 * 7-9s typical, well past the spec's 8s streaming line); the resolved value is
 * still the FULL text plus token usage, so the caller stores and audits exactly
 * what it did before. Callers that don't want the chunks pass no `onDelta`.
 *
 * `prefill` seeds the assistant turn. Use it for structure the caller REQUIRES
 * rather than merely requests: the review's section labels are load-bearing —
 * the panel streams into a titled layout keyed off them — and asking Haiku
 * nicely for them in the system prompt does not work. It complied 4/4 when the
 * prompt was replayed through Claude Code subagents and 0/1 against the real
 * API, which is exactly the kind of gap a prompt eval cannot see. Prefilling
 * the first label makes it a fact instead of a request, and having emitted one
 * label the model reliably emits the rest.
 *
 * The API does not echo the prefill, so it is prepended to the returned content
 * AND pushed through `onDelta` first — otherwise the client's stream would be
 * missing its opening label while the stored row had it.
 *
 * ⚠️ A prefill must NOT end with whitespace — the API rejects the request with
 * "final assistant content cannot end with trailing whitespace". Trimmed here
 * so no caller has to remember.
 */
export async function generateReview(
  system: string,
  user: string,
  onDelta?: (text: string) => void,
  prefill?: string
): Promise<AiGeneration> {
  if (!client) client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  const seed = prefill?.replace(/\s+$/, '');
  if (seed) messages.push({ role: 'assistant', content: seed });
  const stream = client.messages.stream({
    model: AI_MODEL,
    max_tokens: 2000,
    system,
    messages,
  });
  if (onDelta) {
    if (seed) onDelta(seed);
    stream.on('text', onDelta);
  }
  const res = await stream.finalMessage();
  if (res.stop_reason === 'refusal') {
    throw new Error('The model declined to review this deck.');
  }
  const generated = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!generated) throw new Error('The model returned an empty review.');
  return {
    content: seed ? `${seed}${generated}` : generated,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

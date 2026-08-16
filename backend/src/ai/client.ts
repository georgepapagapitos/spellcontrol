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
  /** `stop_reason === 'max_tokens'` — the reply was cut off, not finished. */
  truncated: boolean;
}

/**
 * One generation, streamed. `onDelta` fires per text chunk so the route can
 * forward it to the client while the model is still writing (T102 — measured
 * 7-9s typical, well past the spec's 8s streaming line); the resolved value is
 * still the FULL text plus token usage, so the caller stores and audits exactly
 * what it did before. Callers that don't want the chunks pass no `onDelta`.
 *
 * `signal` cancels the in-flight call (e.g. the client disconnected) — the
 * route wires an `AbortController` per request.
 *
 * This used to take a `prefill` that seeded the assistant turn to force the
 * review's section labels. Removed: an assistant prefill returns HTTP 400 on
 * every Claude 4.6-and-later model, so it silently pinned the feature to
 * Haiku 4.5 despite the "tier is a one-string change" comment above. A live
 * probe on 2026-08-16 (2 fixtures x 3 runs, prompt v6, no prefill) got all
 * three labels right in 6/6 runs unaided — the prefill was compensating for
 * prompt v4's weaker label instruction, and later prompt versions fixed that
 * independently.
 */
export async function generateReview(
  system: string,
  user: string,
  onDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<AiGeneration> {
  if (!client) client = new Anthropic();
  const stream = client.messages.stream(
    {
      model: AI_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    },
    { signal }
  );
  if (onDelta) stream.on('text', onDelta);
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
    content: generated,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    truncated: res.stop_reason === 'max_tokens',
  };
}

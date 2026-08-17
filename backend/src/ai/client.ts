import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { createMarkerGate, runTool, type AiTool, type FetchedCard } from './tools';

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
  /**
   * Every card the model retrieved via a tool this conversation. These are real
   * by construction (they came back from our own card cache), so they are the
   * allowlist the route checks the finished prose against.
   */
  fetched: FetchedCard[];
}

/**
 * Give up rather than loop forever if the model keeps calling tools. Measured
 * at n=12: a typical review searches 3 times, but the long tail reaches 12
 * lookups across ~8 turns, and a cap of 6 cut three of those off mid-answer.
 */
const MAX_TOOL_ITERATIONS = 10;

/**
 * Per-TURN output cap.
 *
 * 2000 was right when one turn was the whole review (~900 tokens of prose).
 * With tools the model also narrates its research, and that narration is
 * charged against the same budget even though the marker gate discards it —
 * measured, a run spent ~1750 tokens thinking out loud and had 250 left for
 * the review, which then truncated mid-word. Raising the ceiling costs nothing
 * on turns that don't need it.
 *
 * 4000 → 6000 when the REFINE pass gained tools: refine has to fit research
 * narration, three paragraphs of prose AND a JSON tail into one budget, and a
 * truncation there costs the tweak list entirely — the tail is the last thing
 * written, so the user gets a strategy read and no suggestions. Measured 1 run
 * in 19 on prompt v4 (5301 output tokens, zero tweaks).
 *
 * ⚠️ The 6000 itself is NOT probe-verified — the Anthropic account ran out of
 * credit part way through that gate, so there was no budget left to re-measure.
 * It is a ceiling, not a target: a turn that doesn't need the room doesn't
 * spend it, and nothing about it can change the output's shape. Re-measure the
 * truncation rate when credits are back.
 */
const MAX_OUTPUT_TOKENS = 6000;

type Cacheable = { cache_control?: Anthropic.CacheControlEphemeral | null };

function markCacheable(block: Cacheable | undefined): void {
  if (block) block.cache_control = { type: 'ephemeral' };
}

/** Drop every breakpoint in the message history, so only the newest one holds. */
function clearCacheControl(messages: Anthropic.MessageParam[]): void {
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const block of message.content) {
      if ('cache_control' in block) delete (block as Cacheable).cache_control;
    }
  }
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
  signal?: AbortSignal,
  options?: { tools?: AiTool[]; answerMarker?: string }
): Promise<AiGeneration> {
  if (!client) client = new Anthropic();
  const tools = options?.tools ?? [];
  const marker = options?.answerMarker;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  const fetched: FetchedCard[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  // Only gate when there are tools AND a marker to gate on. Without tools the
  // model has nothing to narrate about, so text streams straight through and
  // the no-tools path behaves exactly as it did before.
  const gate = tools.length > 0 && marker ? createMarkerGate(marker, onDelta) : null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = client.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => t.definition),
              // `tools` renders ahead of `system`, so the shared prefix is now
              // long enough to clear Haiku 4.5's 4096-token cache minimum —
              // which the system prompt alone never did. One breakpoint on the
              // last system block covers tools + system together.
              system: [
                {
                  type: 'text' as const,
                  text: system,
                  cache_control: { type: 'ephemeral' as const },
                },
              ],
            }
          : {}),
      },
      { signal }
    );
    if (gate) stream.on('text', (t) => gate.push(t));
    else if (onDelta) stream.on('text', onDelta);

    const res = await stream.finalMessage();
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;

    if (res.stop_reason === 'refusal') {
      throw new Error('The model declined to review this deck.');
    }

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) {
      const generated = gate
        ? gate.text.trim()
        : res.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
      if (!generated) throw new Error('The model returned an empty review.');
      return {
        content: generated,
        inputTokens,
        outputTokens,
        truncated: res.stop_reason === 'max_tokens',
        fetched,
      };
    }

    // Truncation mid-tool-call leaves an unanswerable tool_use — the input JSON
    // is incomplete, so running it would act on half a request.
    if (res.stop_reason === 'max_tokens') {
      throw new Error('The model ran out of room mid tool call.');
    }

    messages.push({ role: 'assistant', content: res.content });
    // All results go back in ONE user message — splitting them across messages
    // trains the model out of calling tools in parallel.
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((use) => {
      const out = runTool(tools, use.name, (use.input ?? {}) as Record<string, unknown>);
      for (const card of out.fetched) {
        if (!fetched.some((f) => f.name === card.name)) fetched.push(card);
      }
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: out.text,
        ...(out.isError ? { is_error: true } : {}),
      };
    });
    messages.push({ role: 'user', content: results });
    // Cache the conversation so far, not just tools+system. Each iteration
    // resends every prior tool result, and card text is bulky — measured 35k
    // input tokens across a 7-lookup review versus 5.6k for the no-tool
    // version. A breakpoint on the newest turn makes the next iteration read
    // that prefix at ~0.1x instead of paying full price for it again.
    //
    // The marker MOVES rather than accumulating: only 4 breakpoints are allowed
    // per request, and a long loop would blow that budget in four turns.
    // Earlier breakpoints stay valid as read points either way.
    clearCacheControl(messages);
    markCacheable(results.at(-1));
    gate?.reset();
  }

  // Out of iterations. If the model already wrote a reviewable answer, keep it
  // rather than failing a request the user waited on.
  if (gate?.opened) {
    logger.warn('[ai] tool loop hit its iteration cap; returning the partial answer');
    return {
      content: gate.text.trim(),
      inputTokens,
      outputTokens,
      truncated: true,
      fetched,
    };
  }
  throw new Error('The model kept calling tools without answering.');
}

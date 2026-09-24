import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AiTool } from './tools';

// A model that searches for as long as it is allowed to. It only writes an
// answer when the request forbids tools (or after `searchTurns`), which is how
// the E388 refine behaved with an empty engine list: ten lookups, no reading.
const requests: Record<string, unknown>[] = [];
// What the model writes when it answers: a marked answer, or (unmarked) the
// narration-only ending the live check saw once tools were forbidden.
let answer = '';
let searchTurns = Infinity;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (params: Record<string, unknown>) => {
        // Snapshot: the loop mutates `messages` after the call.
        requests.push(JSON.parse(JSON.stringify(params)));
        const forbidden = (params.tool_choice as { type?: string } | undefined)?.type === 'none';
        const answers = forbidden || requests.length > searchTurns;
        const content: {
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: object;
        }[] = answers
          ? [{ type: 'text', text: answer }]
          : [{ type: 'tool_use', id: `t${requests.length}`, name: 'lookup_cards', input: {} }];
        // The answer marker is read from streamed `text` events, like the SDK's.
        const onText: ((t: string) => void)[] = [];
        return {
          on: (event: string, cb: (t: string) => void) => {
            if (event === 'text') onText.push(cb);
          },
          finalMessage: async () => {
            for (const block of content) {
              if (block.type === 'text') for (const cb of onText) cb(block.text as string);
            }
            return {
              content,
              stop_reason: answers ? 'end_turn' : 'tool_use',
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        };
      },
    };
  },
}));

const lookup: AiTool = {
  definition: { name: 'lookup_cards', input_schema: { type: 'object' as const } } as Anthropic.Tool,
  run: () => ({
    text: 'Sol Ring {1}: {T}: Add {C}{C}.',
    fetched: [{ name: 'Sol Ring', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' }],
  }),
};

beforeEach(() => {
  requests.length = 0;
  answer = '---STRATEGY---\nThe deck wants more ramp.';
  searchTurns = Infinity;
});

describe('generateReview tool loop', () => {
  it('forces the last turn to answer instead of failing when the model keeps searching', async () => {
    const { generateReview, FINAL_TURN_NOTE } = await import('./client');
    const gen = await generateReview('system', 'user', undefined, undefined, {
      tools: [lookup],
      answerMarker: '---STRATEGY---',
    });

    expect(gen.content).toContain('The deck wants more ramp.');
    expect(requests).toHaveLength(10);
    // Only the final turn is restricted; every earlier turn may still search.
    expect(requests.slice(0, 9).every((r) => r.tool_choice === undefined)).toBe(true);
    expect(requests[9].tool_choice).toEqual({ type: 'none' });
    // Forbidding tools alone got "Let me look for…" and a stop, live: the last
    // turn has to be TOLD the search is over.
    const lastUser = (requests[9].messages as Anthropic.MessageParam[]).at(-1)!;
    expect(lastUser.role).toBe('user');
    expect((lastUser.content as { type: string; text?: string }[]).at(-1)).toEqual({
      type: 'text',
      text: FINAL_TURN_NOTE,
    });
    expect(JSON.stringify(requests[8].messages)).not.toContain(FINAL_TURN_NOTE);
  });

  it('fails instead of returning a blank answer when the model ends without the marker', async () => {
    // With cards fetched, an unmarked ending used to come back as an EMPTY
    // reading, stored against the user's quota.
    answer = 'Let me look for cards that reward artifact creation:';
    searchTurns = 2;
    const { generateReview } = await import('./client');
    await expect(
      generateReview('system', 'user', undefined, undefined, {
        tools: [lookup],
        answerMarker: '---STRATEGY---',
      })
    ).rejects.toThrow('The model returned an empty review.');
  });

  it('still lets an unmarked research pass return nothing but its fetched cards', async () => {
    answer = '';
    searchTurns = 1;
    const { generateReview } = await import('./client');
    const gen = await generateReview('system', 'user', undefined, undefined, { tools: [lookup] });
    expect(gen.content).toBe('');
    expect(gen.fetched.map((f) => f.name)).toEqual(['Sol Ring']);
  });
});

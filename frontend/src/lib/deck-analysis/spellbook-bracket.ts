import { fetchWithAbortTimeout } from '@/lib/api/fetch-utils';

/**
 * Commander Spellbook's bracket tags, which are their scheme and not ours:
 * named tags, with no one-to-one line to Brackets 1 to 5. They are shown as
 * Spellbook words and never converted to a number.
 */
export const SPELLBOOK_TAG_LABELS = {
  E: 'Exhibition',
  C: 'Core',
  O: 'Oddball',
  P: 'Powerful',
  S: 'Spicy',
  R: 'Ruthless',
  B: 'Banned',
} as const;

export type SpellbookTag = keyof typeof SPELLBOOK_TAG_LABELS;

export const SPELLBOOK_SITE_URL = 'https://commanderspellbook.com/';

export interface SpellbookRequest {
  commanders: string[];
  cards: { name: string; quantity: number }[];
}

/** The decklist the proxy takes: commanders apart, the mainboard by name and count. */
export function buildSpellbookRequest(
  commanders: readonly (string | undefined)[],
  mainboardNames: readonly string[]
): SpellbookRequest {
  const counts = new Map<string, number>();
  for (const n of mainboardNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  return {
    commanders: commanders.filter((n): n is string => !!n),
    cards: [...counts].map(([name, quantity]) => ({ name, quantity })),
  };
}

/** Why there is no verdict: Spellbook (or our budget for it) said no, or the call itself failed. */
export class SpellbookError extends Error {
  constructor(readonly kind: 'unavailable' | 'failed') {
    super(kind);
    this.name = 'SpellbookError';
  }
}

export async function fetchSpellbookBracket(req: SpellbookRequest): Promise<SpellbookTag> {
  let res: Response;
  try {
    res = await fetchWithAbortTimeout(
      '/api/spellbook/bracket',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      12_000,
      'Spellbook timed out'
    );
  } catch {
    throw new SpellbookError('failed');
  }
  if (res.status === 503) throw new SpellbookError('unavailable');
  if (!res.ok) throw new SpellbookError('failed');
  const body = (await res.json().catch(() => null)) as { tag?: unknown } | null;
  const tag = body?.tag;
  if (typeof tag !== 'string' || !(tag in SPELLBOOK_TAG_LABELS)) throw new SpellbookError('failed');
  return tag as SpellbookTag;
}

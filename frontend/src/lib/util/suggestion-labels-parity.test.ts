/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The suggestion-label surfaces the client sends and the ones the server keeps
 * must be the same list: the server drops an event whose surface it does not
 * know, with a 204 and no row, so a surface added on one side only records
 * nothing and nothing says so (the same trap as analytics-parity.test.ts).
 */
const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, 'suggestion-labels.ts'), 'utf8');
const server = readFileSync(
  join(here, '..', '..', '..', '..', 'backend', 'src', 'routes', 'suggestion-labels.ts'),
  'utf8'
);

describe('suggestion label surfaces', () => {
  it('match between the client union and the server allowlist', () => {
    const union = /export type SuggestionSurface =([\s\S]*?);/.exec(client)?.[1];
    const set = /export const SUGGESTION_SURFACES = new Set\(\[([\s\S]*?)\]\)/.exec(server)?.[1];
    expect(union).toBeTruthy();
    expect(set).toBeTruthy();
    const names = (s: string) => [...s.matchAll(/'([a-z:-]+)'/g)].map((m) => m[1]).sort();
    expect(names(union!)).toEqual(names(set!));
  });
});

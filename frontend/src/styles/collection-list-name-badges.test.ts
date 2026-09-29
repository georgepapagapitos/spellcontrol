/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');
const row = readFileSync(join(here, '../components/shared/CardRow.tsx'), 'utf8');

/**
 * A collection row's name line: only the name truncates.
 *
 * `.collection-list-name` was one ellipsis box holding the name with its
 * badges inline. On a phone, a long name ("Anguished Unmaking", "Atraxa,
 * Praetors' Voice") filled the box and the ellipsis clipped every deck, cube
 * and binder badge after it, so the row said nothing about where the card
 * was. Now the line is a flex row: the name sits in its own truncating span,
 * the one item that shrinks, and every badge keeps its size.
 */
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1];
};

describe('collection row name line — only the name truncates', () => {
  it('the line is a flex row, not one ellipsis box', () => {
    const body = rule('.collection-list-name');
    expect(body, 'no base .collection-list-name rule').toBeTruthy();
    expect(body).toMatch(/display:\s*flex/);
    expect(body).not.toMatch(/text-overflow/);
  });

  it('badges never shrink; the name is the one item that does, with a floor', () => {
    expect(rule('.collection-list-name > *')).toMatch(/flex-shrink:\s*0/);
    const name = rule('.collection-list-name > .collection-list-name-text');
    expect(name).toMatch(/flex-shrink:\s*1/);
    expect(name).toMatch(/min-width:/);
  });

  it('both CardRow layouts wrap the name in the truncating span', () => {
    const spans = row.match(
      /className="collection-list-name-text card-name-chip-text" title=\{card\.name\}>\s*<CardName card=\{card\} \/>/g
    );
    expect(spans).toHaveLength(2);
  });
});

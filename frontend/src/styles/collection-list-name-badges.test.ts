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

  it('the floor never exceeds the name, so a short name cannot push its badges out', () => {
    // `min-width: min(6ch, 100%)` grew "Bayou" past its own text and the
    // line's overflow clipped the proxy chip after it. Any floor must be
    // capped by the name's own max-content width.
    const floors = [...css.matchAll(/\.collection-list-name-text\s*\{([^}]*)\}/g)]
      .map((m) => m[1].match(/min-width:\s*([^;]+);/)?.[1].trim())
      .filter((v): v is string => !!v);
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) {
      expect(floor === '0' || /^calc-size\(max-content,\s*min\(size,/.test(floor), floor).toBe(
        true
      );
    }
  });

  it('the Owned verdict badge is spaced off the name like every other badge', () => {
    expect(rule('.collection-list-name > .verdict-badge')).toMatch(/margin-left:\s*var\(--space-/);
  });

  it('both CardRow layouts wrap the name in the truncating span', () => {
    const spans = row.match(
      /className="collection-list-name-text card-name-chip-text" title=\{card\.name\}>\s*<CardName card=\{card\} \/>/g
    );
    expect(spans).toHaveLength(2);
  });
});

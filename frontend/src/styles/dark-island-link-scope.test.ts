/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// `.card-preview-ext-link` paints rgba(255 255 255 / 70%) text with a white
// dotted rule: it is a link for the card preview's always-dark island
// (footer-card-preview.css). Reused on an ordinary theme surface it is white on
// paper, about 1.1:1 and unreadable in every light theme. The Commander
// Spellbook credit in the Bracket panel did exactly that (found in the wave 4
// browser pass, W5v). A link outside the preview takes `.text-link`.

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose markup only ever renders inside `.card-preview-panel`. */
const INSIDE_THE_PREVIEW = new Set([
  'components/card/CardPreview.tsx',
  'components/card/PlayedInSection.tsx',
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

describe('dark-island links stay inside the dark island', () => {
  it('only the card preview uses card-preview-ext-link', () => {
    const outside = sources(src)
      .map((p) => relative(src, p))
      .filter((rel) => !INSIDE_THE_PREVIEW.has(rel))
      .filter((rel) => /card-preview-ext-link/.test(readFileSync(join(src, rel), 'utf8')));
    expect(outside, 'use className="text-link" outside the card preview panel').toEqual([]);
  });
});

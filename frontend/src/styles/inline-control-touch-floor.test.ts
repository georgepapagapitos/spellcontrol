/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(src, f), 'utf8');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Controls that live inside a line of text (a sentence, a table cell, a
 * heading) can't take a `min-height` without pushing that line apart, so they
 * meet the coarse-pointer floor with a centred `::after` ghost instead
 * (STYLE_GUIDE § Responsive). Both of these shipped with no floor at all
 * (T152 W8d): the leaderboard's Retry / View / Hide link was the height of its
 * text, and the rename button that is the pod's name in the pod hub's heading
 * had `padding: 0`.
 */
const CASES: Array<[file: string, selector: string]> = [
  ['components/play/FriendsLeaderboard.css', '.link-button'],
  ['pages/PodHubPage.css', '.pod-hub-name-btn'],
];

describe('inline controls meet the coarse touch floor', () => {
  for (const [file, selector] of CASES) {
    it(`${selector} carries a 44px ghost under a coarse pointer`, () => {
      const css = read(file);
      const sel = escape(selector);
      const ghost = new RegExp(
        `@media \\(pointer: coarse\\)\\s*\\{\\s*${sel}::after\\s*\\{([^}]*)\\}`
      ).exec(css)?.[1];
      expect(ghost, `no coarse ${selector}::after ghost in ${file}`).toBeTruthy();
      expect(ghost).toContain('position: absolute');
      expect(ghost).toContain('height: 44px');
      expect(ghost).toMatch(/min-width:\s*44px/);
      expect(ghost).toContain('translate(-50%, -50%)');
      // The ghost centres on its own control only if that control is a
      // positioning context.
      expect(css).toMatch(new RegExp(`\\n${sel}\\s*\\{[^}]*position:\\s*relative`));
    });
  }
});

/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Guard for the boxed <Tabs> strip (components/overlays/Tabs.tsx, `fitted` /
// `scrollable`). The `className` a consumer passes lands on the `.sc-tabs`
// element ITSELF — the box that paints the strip's background + border and
// whose own 0.2rem padding keeps the active pill inset. A consumer rule that
// sets `padding` on that class to position the strip inside a dialog replaces
// the inset: the strip's background runs edge to edge while the pill sits
// flush against one side (the rules reference, the binder card editor and the
// opponent board all shipped this way, 2026-09-10). Position the strip with
// `margin`; let the primitive own its box.
//
// `underline` / `hub` reset the box look themselves (transparent, no border,
// their own padding), so a consumer padding there is a layout choice, not a
// defect — they're exempt.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, ext));
    else if (entry.endsWith(ext) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/** Every boxed <Tabs …/> usage's className, with the file it's in. */
function boxedTabClasses(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const file of files(srcRoot, '.tsx')) {
    const src = readFileSync(file, 'utf8');
    let at = src.indexOf('<Tabs');
    while (at !== -1) {
      // <Tabs …/> is always self-closing; `=>` inside handlers has no `/>`.
      const end = src.indexOf('/>', at);
      const jsx = src.slice(at, end === -1 ? undefined : end);
      const variant = /variant="([a-z]+)"/.exec(jsx)?.[1] ?? 'fitted';
      const className = /className="([^"]+)"/.exec(jsx)?.[1];
      if (className && (variant === 'fitted' || variant === 'scrollable')) {
        out.push([relative(srcRoot, file), className]);
      }
      at = src.indexOf('<Tabs', at + 1);
    }
  }
  return out;
}

const css = files(srcRoot, '.css')
  .map((f) => [relative(srcRoot, f), readFileSync(f, 'utf8')] as const)
  .filter(([, text]) => !text.startsWith('/* stylelint-disable'));

describe('boxed <Tabs> consumers position the strip with margin, not padding', () => {
  const consumers = boxedTabClasses();

  it('finds the known boxed consumers', () => {
    const classes = consumers.map(([, c]) => c);
    expect(classes).toEqual(
      expect.arrayContaining(['rules-ref-tabs', 'binder-card-editor-tabs', 'opponent-board-tabs'])
    );
  });

  for (const [tsx, className] of consumers) {
    it(`.${className} (${tsx}) sets no padding on the strip`, () => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Rules whose selector list contains exactly `.className` (optionally
      // within a media block) — not descendants like `.className .sc-tab`.
      const re = new RegExp(`(?:^|[\\s,}])\\.${escaped}\\s*\\{([^}]*)\\}`, 'g');
      for (const [file, text] of css) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          expect(
            /(?:^|[\s;])padding(?:-[a-z]+)?\s*:/.test(m[1]),
            `.${className} in ${file} sets padding on the <Tabs> strip — ` +
              `use margin; padding replaces the primitive's 0.2rem pill inset`
          ).toBe(false);
        }
      }
    });
  }
});

describe('four-tab fitted strips wrap below the sheet breakpoint', () => {
  // E280: a fitted strip shares the row equally, so four labeled tabs with
  // count badges ellipsize on a 360px sheet ("Bat…", "Gra…", "Co…"). The
  // strip wraps to 2×2 under 600px instead; this pins the wrap so a later
  // "tidy" of the file cannot silently restore the truncation.
  const STRIPS: Array<[string, string]> = [
    ['playtest/components/OpponentBoardModal.css', '.opponent-board-tabs'],
  ];

  for (const [file, selector] of STRIPS) {
    it(`${selector} wraps its tabs under 600px`, () => {
      const text = readFileSync(join(srcRoot, file), 'utf8');
      const narrow = /@media \(max-width: 599px\)\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        new RegExp(`${escaped}\\s*\\{[^}]*flex-wrap:\\s*wrap`).test(narrow),
        `${selector} (${file}) has no flex-wrap: wrap in a (max-width: 599px) block`
      ).toBe(true);
      expect(
        new RegExp(`${escaped} \\.sc-tab\\s*\\{[^}]*flex:\\s*1 1 calc\\(50%`).test(narrow),
        `${selector} .sc-tab (${file}) must take a ~50% basis so the strip wraps 2×2`
      ).toBe(true);
    });
  }
});

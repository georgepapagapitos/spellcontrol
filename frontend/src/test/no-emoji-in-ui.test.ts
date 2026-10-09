/**
 * Guard: no system emoji in shipped UI source (frontend/STYLE_GUIDE.md § Icon
 * scale; board E597).
 *
 * Emoji render per OS (Apple, Google, Microsoft and Samsung each draw their
 * own), ignore the theme's colors and clash with the app's line-icon art
 * direction. The play surfaces used to mark Monarch, Initiative, City's
 * Blessing and the winner with them, the only place the app did.
 *
 * THE FIX: use a `lucide-react` icon on the icon scale, `aria-hidden`, with the
 * name kept as visible text or an `aria-label` on the parent (a glyph alone is
 * not an accessible name, and touch has no hover tooltip). If a data table
 * stored the emoji as a string `icon`, store the component (`Icon: Crown`).
 *
 * What is scanned: string / template / JSX text tokens in non-test source,
 * so comments may still mention a glyph. What counts: any code point with
 * emoji presentation by default (🏆 ✋ ⬛) or followed by the VS16 selector
 * (⚠️). Text-presentation marks (✓ ✕ ★ ☠ ⚔) are typography, not emoji, and
 * are not flagged here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const EMOJI = /\p{Emoji_Presentation}|️/u;

// Files where the emoji is the content itself, not decoration. Keep this list
// to user-chosen or plain-text-export content, with the reason.
const ALLOWLIST: Record<string, string> = {
  // The reaction palette players send each other: an emoji picker by nature.
  'playtest/lib/table-signals.ts': 'reaction emotes are the user-facing content',
  // Daily puzzle result grid copied to the clipboard as plain text to paste
  // into a chat, where only emoji squares carry color.
  'lib/daily/share.ts': 'plain-text share grid',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (EMOJI.test(node.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push(`${line + 1}: ${node.text.trim().slice(0, 40)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('no emoji in UI source', () => {
  it('uses lucide icons, never emoji pictographs', () => {
    const bad: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel in ALLOWLIST) continue;
      for (const hit of offenders(file)) bad.push(`${rel}:${hit}`);
    }
    expect(bad, 'Replace each with a lucide-react icon (see this file header)').toEqual([]);
  });

  it('keeps every allowlist entry live', () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      expect(
        offenders(path.join(SRC, rel)).length,
        `${rel} no longer needs allowlisting`
      ).toBeGreaterThan(0);
    }
  });
});

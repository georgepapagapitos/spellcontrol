/**
 * Icon meaning guard — STYLE_GUIDE `## Icon scale`, "One glyph, one meaning".
 *
 * The sparkle is the generic "AI" glyph of generated interfaces
 * (trove `plugins/polish/reference/ui-tells.md`, Icons and imagery). The app
 * used it for eight unrelated things: AI-written content, the synergy role,
 * new arrivals, the EDHREC build mode, the ramp chip, the Next best move
 * header, a combo seed and the collection summary. On every one of those it
 * read as "the machine did this". So:
 *
 *   - `Sparkles` (and its kin) mark AI, and only on the files below;
 *   - the sparking wand (`Wand2`) marks generating or filling a deck, and only on
 *     the files below.
 *
 * Every other use takes the lucide icon that names its own thing (`Combine` for
 * synergy, `Sprout` for ramp, `ListOrdered` for a ranked list), or no icon.
 * A new file importing one of these glyphs fails: pick the icon that names the
 * thing, or, if it really is AI or deck generation, add the file here with why.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SKIP_FILE = /(\.test\.tsx?$|\.d\.ts$|\/fixtures?\/|__fixtures__|__snapshots__|\.stories\.)/;

const SPARKLE = /^(Lucide)?(Sparkles?|WandSparkles)(Icon)?$/;
// Wand2 is the wand with sparks at its tip. The plain `Wand` (the playtest log's main
// phase, where spells are cast) carries no sparkle and is a game glyph, not this one.
const WAND = /^(Lucide)?Wand2(Icon)?$/;

/** file (relative to src) -> why the sparkle is right there. */
const SPARKLE_ALLOWED: Record<string, string> = {
  'components/deck/AiMarker.tsx': 'the AI-written marker on generated reviews and reasons',
  'pages/you/YouNav.tsx': 'the AI settings section, which is the AI feature itself',
};

/** file (relative to src) -> the generate or fill action the wand marks. */
const WAND_ALLOWED: Record<string, string> = {
  'components/browse/use-browse-preview.tsx': 'Build a deck: opens the generator on this commander',
  'components/card/PlayedInSection.tsx': 'Build a deck: opens the generator on this commander',
  'components/share/SharedDeckSurface.tsx': 'Generate your own from a precon commander',
  'components/deck/NextBestMove.tsx': 'Fill: generates the remaining slots',
  'pages/DeckNewPage.tsx': 'Generate a deck',
  'pages/DecksIndexPage.tsx': 'Build a deck, the empty index door to the generator',
  'pages/WelcomePage.tsx': 'Generate Commander decks, the feature row',
};

// The chain link means a link: a URL to copy or import from, link visibility,
// a playtest card attached to another. #2976 moved the synergy role off the
// sparkle onto Link2, giving the chain link a second meaning; it is Combine now.
const LINK = /^(Lucide)?Link2(Icon)?$/;

/** file (relative to src) -> the link the chain-link glyph marks. */
const LINK_ALLOWED: Record<string, string> = {
  'components/deck/DeckVisibilityChip.tsx': 'Link visibility: anyone with the link',
  'components/deck/ImportDeckDialog.tsx': 'Import from a deck link',
  'components/import/UploadPanel.tsx': 'Import from a link',
  'components/overlays/OverflowMenu.tsx': 'Copy link',
  'components/rules/RulesEntryMenu.tsx': 'Copy link to the rule',
  'playtest/components/PlaytestCardFace.tsx': 'Attached: linked to another permanent',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name) && !SKIP_FILE.test(full.replace(/\\/g, '/'))) out.push(full);
  }
  return out;
}

/** Every name imported from lucide-react in a file (the original name, not the alias). */
export function lucideImports(source: string, fileName = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX
  );
  const names: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.moduleSpecifier.text.startsWith('lucide-react')) continue;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
    }
  }
  return names;
}

const files = walk(ROOT).map((f) => ({
  rel: path.relative(ROOT, f).replace(/\\/g, '/'),
  names: lucideImports(fs.readFileSync(f, 'utf8'), f),
}));

describe('icon meaning (STYLE_GUIDE § Icon scale, one glyph, one meaning)', () => {
  it('reads aliased and suffixed lucide imports', () => {
    expect(lucideImports("import { Sparkles as S, WandSparkles, X } from 'lucide-react';")).toEqual(
      ['Sparkles', 'WandSparkles', 'X']
    );
    expect(SPARKLE.test('SparklesIcon')).toBe(true);
    expect(WAND.test('Wand2')).toBe(true);
    expect(WAND.test('Wand')).toBe(false);
  });

  it('the sparkle marks AI-written content and nothing else', () => {
    const hits = files
      .filter((f) => f.names.some((n) => SPARKLE.test(n)) && !(f.rel in SPARKLE_ALLOWED))
      .map((f) => f.rel);
    expect(
      hits,
      `Sparkles outside the AI surfaces: name the thing instead\n${hits.join('\n')}`
    ).toEqual([]);
  });

  it('the wand marks generating or filling a deck and nothing else', () => {
    const hits = files
      .filter((f) => f.names.some((n) => WAND.test(n)) && !(f.rel in WAND_ALLOWED))
      .map((f) => f.rel);
    expect(hits, `a wand outside generate/fill actions\n${hits.join('\n')}`).toEqual([]);
  });

  it('the chain link marks a link and nothing else (not the synergy role)', () => {
    const hits = files
      .filter((f) => f.names.some((n) => LINK.test(n)) && !(f.rel in LINK_ALLOWED))
      .map((f) => f.rel);
    expect(hits, `Link2 outside link surfaces\n${hits.join('\n')}`).toEqual([]);
  });

  it('every allowlist entry is still a real use (shrink the list when one goes)', () => {
    const stale = [
      ...Object.keys(SPARKLE_ALLOWED).filter(
        (rel) => !files.find((f) => f.rel === rel)?.names.some((n) => SPARKLE.test(n))
      ),
      ...Object.keys(LINK_ALLOWED).filter(
        (rel) => !files.find((f) => f.rel === rel)?.names.some((n) => LINK.test(n))
      ),
      ...Object.keys(WAND_ALLOWED).filter(
        (rel) => !files.find((f) => f.rel === rel)?.names.some((n) => WAND.test(n))
      ),
    ];
    expect(stale).toEqual([]);
  });
});

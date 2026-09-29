/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// Every index tile answers the pointer the same way, defined once in
// styles/base-layout.css (§ Index tiles): the frame rings in the tile's own
// colour and lifts, and in grid the cover art zooms.
//
// It was three behaviours, each family writing its own: Discover and the
// profile tiles zoomed the art, while the decks and binders indexes tinted a
// border. #2486 then removed that border from every tile, so the decks and
// binders hover did nothing at all, and nothing noticed. A family may still
// style its own controls on hover (Discover's quick actions, the ⋮), but not
// the tile's frame or its cover art.
//
// Read off disk: CSS `?raw` imports come back empty under this setup.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'styles/base-layout.css';

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Split a selector list on its top-level commas (not the ones in :is()). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The tile families: the li, and the family classes layered on it. */
const TILES = [
  'decks-index-card',
  'binders-index-card',
  'discover-tile',
  'public-profile-tile',
  'deck-library-tile',
];
const ART = ['decks-index-card-art', 'binders-index-card-art'];
/** What the shared hover owns on the tile itself. Not `outline`: a tile that
 *  takes focus in select mode keeps its own keyboard ring. */
const FRAME_PROPS = ['box-shadow', 'border', 'border-color', 'transform', 'translate'];
const ART_PROPS = ['transform', 'scale', 'translate', 'transition'];

const STATE = ':(?:hover|focus-visible|focus-within)';
const tileInState = new RegExp(`\\.(?:${TILES.join('|')})(?![\\w-])[^\\s>+~]*${STATE}`);
const tileIsSubject = new RegExp(
  `\\.(?:${TILES.join('|')})(?![\\w-])[^\\s>+~]*${STATE}[^\\s>+~]*$`
);
const artIsSubject = new RegExp(`\\.(?:${ART.join('|')})(?![\\w-])[^\\s>+~]*$`);

interface Rule {
  file: string;
  selector: string;
  props: string[];
}

function rules(): Rule[] {
  const out: Rule[] = [];
  for (const f of cssFiles(srcRoot)) {
    const file = relative(srcRoot, f).split(sep).join('/');
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const props = [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((p) => p[1]);
      for (const selector of splitSelectors(m[1])) out.push({ file, selector, props });
    }
  }
  return out;
}

describe('index tiles share one hover (§ Index tiles)', () => {
  const all = rules();

  it('no family gives the tile its own hover or focus frame', () => {
    const offenders = all
      .filter((r) => r.file !== OWNER && tileIsSubject.test(r.selector))
      .filter((r) => r.props.some((p) => FRAME_PROPS.includes(p)))
      .map((r) => `${r.file}: ${r.selector}`);
    expect(offenders).toEqual([]);
  });

  it('no family moves a tile cover on hover, or at all', () => {
    const offenders = all
      .filter((r) => r.file !== OWNER && artIsSubject.test(r.selector))
      .filter((r) => r.props.some((p) => ART_PROPS.includes(p)))
      .map((r) => `${r.file}: ${r.selector}`);
    expect(offenders).toEqual([]);
  });

  it('a family may still reveal its own controls on hover', () => {
    const discover = all.filter(
      (r) => r.file === 'components/DiscoverDeckTile.css' && tileInState.test(r.selector)
    );
    expect(discover.some((r) => r.selector.endsWith('.tile-actions'))).toBe(true);
  });

  it('base-layout.css rings, lifts and zooms every tile, pointer and keyboard alike', () => {
    const own = all.filter((r) => r.file === OWNER);
    const css = readFileSync(join(srcRoot, OWNER), 'utf8');
    const hover = own.filter((r) => r.selector.endsWith(':hover'));
    const focus = own.filter((r) => /:focus-visible \)$/.test(r.selector));
    expect(hover.some((r) => r.props.includes('box-shadow'))).toBe(true);
    expect(focus.some((r) => r.props.includes('box-shadow'))).toBe(true);
    expect(css).toContain('var(--shadow-card-hover),\n    0 0 0 1px var(--tile-color);');
    expect(
      own.filter((r) => artIsSubject.test(r.selector) && r.props.includes('transform'))
    ).toHaveLength(2);
  });
});

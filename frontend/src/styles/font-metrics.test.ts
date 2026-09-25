/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

/**
 * Every face a type set ships centres its capital height in the line box.
 *
 * A browser places a glyph by the font's own ascent/descent, and those are
 * never symmetric around the capitals: Segoe UI's capitals sat 6.5% of an em
 * below the centre of the line box and Eczar's 7% above it. Anything that
 * centres a label by its box (every `.btn`, `.pill-btn`, chip and tab is a
 * flex row with `align-items: center`) therefore drew its text a pixel or two
 * off the icon beside it, low in one set and high in the next.
 *
 * The fix is one pair of descriptors per @font-face, chosen so the capital
 * height sits exactly mid-box while the total (and so `line-height: normal`)
 * stays what the font had:
 *
 *   ascent-override  = (ascent + descent + capHeight) / 2
 *   descent-override = (ascent + descent - capHeight) / 2
 *
 * with ascent/descent being the pair browsers use: OS/2 typo metrics when the
 * font sets USE_TYPO_METRICS, hhea otherwise. This test re-reads each woff2's
 * own tables and fails on a face without the overrides or with stale numbers,
 * so a face added later, or a file swapped for a newer cut, can't bring the
 * offset back. `text-box-trim` would be the CSS-level fix, but it only applies
 * to block containers, and a button's bare text node is an anonymous flex item.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicFonts = join(here, '../../public/fonts');

// The first 63 table tags a woff2 directory can encode as a one-byte index.
const KNOWN_TAGS = (
  'cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,' +
  'gasp,hdmx,kern,LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,' +
  'COLR,CPAL,SVG ,sbix,acnt,avar,bdat,bloc,bsln,cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,' +
  'lcar,mort,morx,opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill'
).split(',');

/** Ascent, descent and cap height as % of the em, read from a woff2's tables. */
function woff2Metrics(buf: Buffer): { ascent: number; descent: number; cap: number } {
  const numTables = buf.readUInt16BE(12);
  let p = 48; // fixed-size woff2 header
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  // Tables sit back to back in one brotli stream, in directory order; a
  // transformed table (glyf/loca by default) is stored at its transformed length.
  const offsets: Record<string, number> = {};
  let offset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    const tag =
      (flags & 0x3f) === 63 ? buf.toString('latin1', p, (p += 4)) : KNOWN_TAGS[flags & 0x3f];
    const origLength = base128();
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    offsets[tag] = offset;
    offset += transformed ? base128() : origLength;
  }
  const data = brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)));
  const at = (tag: string, o: number) => offsets[tag] + o;
  expect(data.readUInt32BE(at('head', 12)), 'head.magicNumber').toBe(0x5f0f3cf5);
  const em = data.readUInt16BE(at('head', 18)) / 100;
  const useTypo = (data.readUInt16BE(at('OS/2', 62)) & 0x80) !== 0;
  const [asc, desc] = useTypo
    ? [data.readInt16BE(at('OS/2', 68)), data.readInt16BE(at('OS/2', 70))]
    : [data.readInt16BE(at('hhea', 4)), data.readInt16BE(at('hhea', 6))];
  return { ascent: asc / em, descent: -desc / em, cap: data.readInt16BE(at('OS/2', 88)) / em };
}

/** Every @font-face in the type-set stylesheets, with where it came from. */
function faces(): { sheet: string; body: string }[] {
  const sheets: [string, string][] = [
    ['styles/fonts.css', readFileSync(join(here, 'fonts.css'), 'utf8')],
    ...readdirSync(publicFonts)
      .filter((f) => /^typeset-[a-z]+\.css$/.test(f))
      .map((f): [string, string] => [
        `public/fonts/${f}`,
        readFileSync(join(publicFonts, f), 'utf8'),
      ]),
  ];
  return sheets.flatMap(([sheet, css]) =>
    (css.match(/@font-face \{[^}]*\}/g) ?? []).map((body) => ({ sheet, body }))
  );
}

const percent = (body: string, prop: string) => {
  const m = body.match(new RegExp(`${prop}: ([\\d.]+)%;`));
  return m ? Number(m[1]) : undefined;
};

describe('type-set faces centre their capital height', () => {
  const all = faces();

  it('finds the default sheet and every per-set sheet', () => {
    // Non-vacuous: six webfont sheets plus plain's local() aliases.
    expect(new Set(all.map((f) => f.sheet)).size).toBe(7);
  });

  for (const { sheet, body } of all) {
    const family = body.match(/font-family: '([^']+)'/)?.[1];
    const file = body.match(/url\('\/fonts\/([^']+)'\)/)?.[1];
    const weight = body.match(/font-weight: ([^;]+);/)?.[1];
    it(`${sheet}: ${family} ${weight}`, () => {
      const ascent = percent(body, 'ascent-override');
      const descent = percent(body, 'descent-override');
      expect(ascent, 'ascent-override').toBeDefined();
      expect(descent, 'descent-override').toBeDefined();
      // A local() face (plain's Segoe UI alias) has no file here to read; its
      // numbers are derived in that sheet's header from segoeui.ttf.
      if (!file) return;
      const m = woff2Metrics(readFileSync(join(publicFonts, file)));
      // Capital height centred: ascent - descent == cap.
      expect(ascent! - descent!).toBeCloseTo(m.cap, 1);
      // Same total as the font's own, so line-height: normal doesn't move.
      expect(ascent! + descent!).toBeCloseTo(m.ascent + m.descent, 1);
    });
  }
});

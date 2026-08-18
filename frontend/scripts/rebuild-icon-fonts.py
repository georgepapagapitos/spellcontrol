#!/usr/bin/env python3
"""Rebuild the mana-font / keyrune icon fonts with correct glyph bounding boxes.

Both upstream packages ship every glyph with the same placeholder bbox
(0, -64, em, 960) rather than the glyph's real bounds. Firefox's font sanitizer
flags each one — ~940 `downloadable font: glyf: Glyph bbox was incorrect;
adjusting` warnings per page load — and the vendor .woff2 carries the same bad
values, so switching format alone doesn't help.

This recomputes every bbox from the outlines and writes a .woff2 into
src/assets/fonts/, which src/styles/icon-fonts.css points its @font-face at.
Re-run it whenever mana-font or keyrune is upgraded, and commit the result:

    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python frontend/scripts/rebuild-icon-fonts.py

Both fonts stay under their upstream MIT licence; only the bboxes change.
"""

import pathlib
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'assets' / 'fonts'
SOURCES = {
    'mana': ROOT / 'node_modules' / 'mana-font' / 'fonts' / 'mana.ttf',
    'keyrune': ROOT / 'node_modules' / 'keyrune' / 'fonts' / 'keyrune.ttf',
}


def fix_bboxes(font):
    """Recalculate every glyph bbox in place; return how many were wrong."""
    glyf = font['glyf']
    wrong = 0
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours <= 0:
            continue
        stored = (glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax)
        glyph.recalcBounds(glyf)
        if stored != (glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax):
            wrong += 1
    return wrong


OUT.mkdir(parents=True, exist_ok=True)
for name, src in SOURCES.items():
    if not src.exists():
        sys.exit(f'missing {src} — run `npm install --prefix frontend` first')
    font = TTFont(src)
    fixed = fix_bboxes(font)
    font.flavor = 'woff2'
    dest = OUT / f'{name}.woff2'
    font.save(dest)
    remaining = fix_bboxes(TTFont(dest))
    assert remaining == 0, f'{dest} still has {remaining} bad bboxes'
    size = dest.stat().st_size // 1024
    print(f'{name}: fixed {fixed} bboxes -> {dest.relative_to(ROOT)} ({size}K)')

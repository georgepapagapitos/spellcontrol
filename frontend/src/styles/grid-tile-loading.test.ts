/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');

/** The declaration block of the first top-level rule that starts with `selector {`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) return '';
  return css.slice(start, css.indexOf('}', start));
}

/**
 * A grid tile whose art has not painted yet shows the card's name on a
 * card-shaped shimmer, behind the image, and the shimmer stops under
 * reduced motion. The image must sit above it or the name never clears.
 */
describe('grid tile loading placeholder', () => {
  it('fills the tile and shimmers', () => {
    const body = rule('.collection-grid-placeholder.is-pending');
    expect(body).toContain('position: absolute');
    expect(body).toContain('inset: 0');
    expect(body).toContain('animation: skeleton-shimmer');
  });

  it('is still under reduced motion', () => {
    const at = css.indexOf(
      '@media (prefers-reduced-motion: reduce) {\n  .collection-grid-placeholder.is-pending'
    );
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, at + 160)).toContain('animation: none');
  });

  it('lays the art over the tile box so a lazy image never has a 0px box', () => {
    // A loading="lazy" <img> with no size never intersects, never loads, and
    // so never paints: the tile stayed on its placeholder forever.
    const body = rule('.collection-grid-img--fill');
    expect(body).toContain('position: absolute');
    expect(body).toContain('inset: 0');
    expect(rule('.collection-grid-item')).toContain('aspect-ratio: 488 / 680');
    expect(rule('.collection-grid-item')).toContain('position: relative');
    const cell = readFileSync(join(here, '../components/shared/CardGridCell.tsx'), 'utf8');
    expect(cell).toContain('className="collection-grid-img collection-grid-img--fill"');
  });

  it('keeps the rarity chip off the art for surfaces that opt out', () => {
    const cell = readFileSync(join(here, '../components/shared/CardGridCell.tsx'), 'utf8');
    expect(cell).toContain('printing && rarityOnArt && (');
    const tile = readFileSync(join(here, '../components/share/SharedCardTile.tsx'), 'utf8');
    expect(tile).toContain('rarityOnArt={false}');
  });
});

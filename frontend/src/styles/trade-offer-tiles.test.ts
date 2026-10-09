/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../components/trade/TradeOfferList.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/**
 * E590: the offer rows drew each card as an 18-20px thumbnail inside a text
 * chip, so you could read what was offered but not see it. A line is now a card
 * tile, and these pin the sizes so it cannot shrink back to a chip.
 */
function bodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1]
  );
}

/** Every `--name: Nrem` value declared anywhere in the sheet, in px. */
function remDecls(name: string): number[] {
  return [...css.matchAll(new RegExp(`${name}:\\s*([0-9.]+)rem`, 'g'))].map(
    (m) => parseFloat(m[1]) * 16
  );
}

describe('trade offer card tiles', () => {
  it('reads the stylesheet at all', () => {
    expect(css).toContain('.trade-offer-chip');
  });

  it('an open tile is a readable card: at least 120px wide at every container width', () => {
    const widths = remDecls('--tile-w');
    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(120);
    // The tiers grow with the room the side has; a desktop side is two across,
    // not three 90px thumbnails (the first cut of this fix, caught in a browser).
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(160);
  });

  it('the two sides align to the top, so a captioned tile cannot drop the other label', () => {
    expect(bodies('.trade-offer-sides')[0]).toMatch(/align-items:\s*start/);
  });

  it('a ledger tile is still a recognisable card, never the old 20px thumb', () => {
    const art = remDecls('--art-w');
    expect(art.length).toBeGreaterThanOrEqual(2);
    for (const w of art) expect(w).toBeGreaterThanOrEqual(44);
  });

  it('the art keeps the card aspect and no fixed pixel width sneaks back in', () => {
    const art = bodies('.trade-offer-art').join('\n');
    expect(art).toMatch(/aspect-ratio:\s*63\s*\/\s*88/);
    const thumb = bodies('.trade-offer-chip-thumb').join('\n');
    expect(thumb).not.toMatch(/\bwidth:\s*\d+px/);
    expect(thumb).toMatch(/width:\s*100%/);
  });

  it('sizes by the side container, not the viewport', () => {
    expect(css).toMatch(/\.trade-offer-side\s*\{[^}]*container:\s*trade-side\s*\/\s*inline-size/);
    expect(css).toMatch(/@container trade-side \(min-width:/);
  });

  it('keeps the 44px coarse-pointer floor on the tile button', () => {
    const coarse = [...css.matchAll(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?\n\})/g)]
      .map((m) => m[1])
      .join('\n');
    expect(coarse).toMatch(/\.trade-offer-chip\s*\{[^}]*min-height:\s*44px/);
  });

  it('keeps a focus-visible ring on the tile', () => {
    expect(bodies('.trade-offer-chip:focus-visible').join('\n')).toMatch(/outline:\s*2px solid/);
  });
});

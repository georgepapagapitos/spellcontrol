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
 * E590 made each line a readable card instead of an 18-20px chip thumbnail.
 * The ledger redesign keeps that floor but turns the row into a balance sheet:
 * one priced line per card, two columns keyed off the CARD's width, each total
 * at the foot of its column. These pin both so neither can quietly regress.
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

describe('trade offer ledger', () => {
  it('reads the stylesheet at all', () => {
    expect(css).toContain('.trade-offer-chip');
  });

  it('a line keeps recognisable card art: never under 44px, 56px where the column has room', () => {
    const art = remDecls('--art-w');
    expect(art.length).toBeGreaterThanOrEqual(4);
    for (const w of art) expect(w).toBeGreaterThanOrEqual(44);
    expect(Math.max(...art)).toBeGreaterThanOrEqual(56);
  });

  it('the art keeps the card aspect and no fixed pixel width sneaks back in', () => {
    const art = bodies('.trade-offer-art').join('\n');
    expect(art).toMatch(/aspect-ratio:\s*63\s*\/\s*88/);
    expect(art).toMatch(/width:\s*var\(--art-w\)/);
    const thumb = bodies('.trade-offer-chip-thumb').join('\n');
    expect(thumb).not.toMatch(/\bwidth:\s*\d+px/);
    expect(thumb).toMatch(/width:\s*100%/);
  });

  it('goes two-column by the card container, never by the viewport', () => {
    expect(bodies('.trade-offer-card').join('\n')).toMatch(
      /container:\s*trade-offer\s*\/\s*inline-size/
    );
    expect(css).toMatch(
      /@container trade-offer \(min-width:[^)]*\)\s*\{\s*\.trade-offer-sides\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/
    );
    expect(css).not.toMatch(/@media\s*\(min-width/);
  });

  it('each total sits at the foot of its column, so the two line up', () => {
    expect(bodies('.trade-offer-sides')[0]).toMatch(/align-items:\s*stretch/);
    expect(bodies('.trade-offer-side').join('\n')).toMatch(/flex-direction:\s*column/);
    expect(bodies('.trade-offer-side-total').join('\n')).toMatch(/margin:\s*auto 0 0/);
  });

  it('prices line up: tabular figures on every line, never wrapped', () => {
    const price = bodies('.trade-offer-line-price').join('\n');
    expect(price).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(price).toMatch(/white-space:\s*nowrap/);
  });

  it('sizes the art by the side container, not the viewport', () => {
    expect(css).toMatch(/\.trade-offer-side\s*\{[^}]*container:\s*trade-side\s*\/\s*inline-size/);
    expect(css).toMatch(/@container trade-side \(min-width:/);
  });

  it('keeps the 44px coarse-pointer floor on the line button', () => {
    const coarse = [...css.matchAll(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?\n\})/g)]
      .map((m) => m[1])
      .join('\n');
    expect(coarse).toMatch(/\.trade-offer-chip\s*\{[^}]*min-height:\s*44px/);
  });

  it('keeps a focus-visible ring on the line', () => {
    expect(bodies('.trade-offer-chip:focus-visible').join('\n')).toMatch(/outline:\s*2px solid/);
  });
});

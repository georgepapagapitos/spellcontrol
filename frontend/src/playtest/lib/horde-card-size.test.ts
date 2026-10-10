// @vitest-environment node
/**
 * Guard (E426): the horde half's card size follows the half's real height,
 * from the same geometry `autoPlace` lays its rows out with. They used to
 * agree only by a fixed `/ 7.6` divisor tuned at 1440x900, so a big screen
 * got ~70px cards and a 1366x768 half (floored at 56px) overlapped its rows.
 *
 * This reads the rule out of playtest.css, evaluates it at real heights, and
 * runs the real `autoPlace` through `measureHordeRect` at each: the
 * permanents and creatures rows must never overlap, and a tall half must
 * get a bigger card than a short one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { autoPlace } from './auto-place';
import { HORDE_RESERVED_BOTTOM, HORDE_RESERVED_TOP, measureHordeRect } from './horde-view';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../styles/playtest.css'),
  'utf8'
);

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

const cardRule = rule('.playtest-main--horde > .horde-half');
const cardW =
  /--pt-card-w:\s*calc\(\s*clamp\(\s*(\d+)px,\s*([\d.]+) \* max\(([\d.]+) \* var\(--pt-horde-half-h\), var\(--pt-horde-half-h\) - (\d+)px\),\s*(\d+)px\s*\)/.exec(
    cardRule
  );

describe('horde half card size follows the half height', () => {
  it('derives --pt-card-w from the half height with a clamp, and the half height from the viewport', () => {
    expect(cardW).not.toBeNull();
    expect(rule('.playtest-main--horde')).toMatch(
      /--pt-horde-half-h:\s*calc\(\(100dvh - var\(--space-0-5\)\) \/ 2\)/
    );
    expect(cardRule).not.toMatch(/\bvh\b/);
  });

  it("keeps the CSS's chrome numbers equal to the ones autoPlace reserves", () => {
    const [, , , share, chromePx] = cardW!;
    expect(Number(chromePx)).toBe(HORDE_RESERVED_TOP.px + HORDE_RESERVED_BOTTOM.px);
    expect(Number(share)).toBeCloseTo(
      1 - HORDE_RESERVED_TOP.fraction - HORDE_RESERVED_BOTTOM.fraction
    );
  });

  const [, min, k, share, chromePx, max] = cardW ?? [];
  const widthAt = (halfH: number) =>
    Math.min(
      Number(max),
      Math.max(Number(min), Number(k) * Math.max(Number(share) * halfH, halfH - Number(chromePx)))
    );

  function placeRows(halfH: number, width: number) {
    const w = widthAt(halfH);
    const el = {
      getBoundingClientRect: () => ({ width, height: halfH }) as DOMRect,
    } as unknown as HTMLElement;
    const orig = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: (p: string) => (p === '--pt-card-w' ? `${w}` : `${w * 1.4}`),
    })) as unknown as typeof getComputedStyle;
    let rect;
    try {
      rect = measureHordeRect(el);
    } finally {
      globalThis.getComputedStyle = orig;
    }
    const card = (id: string, typeLine: string): PlaytestCard => ({ id, name: id, typeLine });
    const bf: BattlefieldCard[] = [];
    const boxes: Record<'permanents' | 'creatures', { top: number; bottom: number }[]> = {
      permanents: [],
      creatures: [],
    };
    // Two horde turns' worth: a full first line of each row, no wrap.
    for (let i = 0; i < 10; i++) {
      for (const [row, type] of [
        ['permanents', 'Enchantment'],
        ['creatures', 'Creature - Zombie'],
      ] as const) {
        const c = card(`${row}-${i}`, type);
        const { y } = autoPlace(c, bf, rect);
        bf.push({ card: c, tapped: false, faceDown: false, counters: {}, stickers: [], x: 0, y });
        const top = y * (halfH - w * 1.4);
        boxes[row].push({ top, bottom: top + w * 1.4 });
      }
    }
    return { w, boxes };
  }

  it.each([
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [1024, 600],
    [3840, 2160],
  ])('never overlaps the permanents and creatures rows at %ix%i', (vw, vh) => {
    const halfH = (vh - 2) / 2;
    const { boxes } = placeRows(halfH, vw);
    const permBottom = Math.max(...boxes.permanents.map((b) => b.bottom));
    const creatTop = Math.min(...boxes.creatures.map((b) => b.top));
    expect(permBottom).toBeLessThanOrEqual(creatTop);
  });

  it('gives a bigger half bigger cards, never below the 1440x900 size, within the ceiling', () => {
    const at900 = widthAt((900 - 2) / 2);
    expect(at900).toBeGreaterThanOrEqual(54);
    expect(widthAt((1080 - 2) / 2)).toBeGreaterThan(at900 * 1.25);
    expect(widthAt((1440 - 2) / 2)).toBeGreaterThan(widthAt((1080 - 2) / 2));
    expect(widthAt(5000)).toBe(Number(max));
  });
});

import { describe, expect, it } from 'vitest';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { autoPlace } from './auto-place';
import {
  cardsUntilNextBoss,
  hordeBandLine,
  hordeLevelLabel,
  hordeStatusText,
  measureHordeRect,
} from './horde-view';
import { buildTestHorde } from './horde-solo.fixtures';

describe('hordeLevelLabel', () => {
  it('capitalizes the level', () => {
    expect(hordeLevelLabel('standard')).toBe('Standard');
    expect(hordeLevelLabel('brutal')).toBe('Brutal');
  });
});

describe('hordeStatusText', () => {
  it('names the arrival turn during setup, then the waiting/reveal/combat/ended lines', () => {
    const horde = buildTestHorde({ armedAtTurn: 1 });
    expect(hordeStatusText(horde, 1)).toBe('Arrives after your turn 3');
    expect(hordeStatusText({ ...horde, phase: 'waiting' }, 3)).toBe(
      'Its turn comes when you pass yours'
    );
    expect(hordeStatusText({ ...horde, phase: 'reveal' }, 3)).toBe('The horde reveals');
    expect(hordeStatusText({ ...horde, phase: 'combat' }, 3)).toBe('The horde attacks');
    expect(hordeStatusText({ ...horde, phase: 'ended', outcome: 'won' }, 3)).toBe(
      'The horde is gone'
    );
    expect(hordeStatusText({ ...horde, phase: 'ended', outcome: 'lost' }, 3)).toBe('Overrun');
  });
});

describe('hordeBandLine', () => {
  it('names the arrival turn during setup', () => {
    const horde = buildTestHorde({ armedAtTurn: 1 });
    expect(hordeBandLine(horde, 1)).toBe('Zombies · arrives after your turn 3');
  });

  it('reads defeated/overran once ended', () => {
    const horde = buildTestHorde({ phase: 'ended', outcome: 'won' });
    expect(hordeBandLine(horde, 5)).toBe('Zombies · defeated');
    expect(hordeBandLine({ ...horde, outcome: 'lost' }, 5)).toBe('Zombies · overran you');
  });
});

describe('cardsUntilNextBoss', () => {
  it('counts down to the next not-yet-crossed tick', () => {
    expect(cardsUntilNextBoss(100, 60, [0.5, 1], [])).toBe(10);
    // Tick 0 (0.5) already crossed — the next is tick 1 (library empty),
    // which is exactly "however many cards remain".
    expect(cardsUntilNextBoss(100, 60, [0.5, 1], [0])).toBe(60);
    expect(cardsUntilNextBoss(100, 0, [0.5, 1], [0, 1])).toBeNull();
  });
});

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: id, ...overrides };
}
function bf(c: PlaytestCard, x = 0, y = 0): BattlefieldCard {
  return { card: c, tapped: false, faceDown: false, counters: {}, stickers: [], x, y };
}

/**
 * Regression (E387 PR 5 follow-up): the horde half's own card-sizing clamp
 * used `/ 5.6` (the throwaway prototype's unvalidated value) against a
 * half-height felt, which left too little `rowsHeight` once
 * `measureHordeRect`'s 0.18/0.24 top/bottom reservation came out of it — an
 * enchantment (permanents row) landed on top of a Zombie token (creatures
 * row) after two horde turns. Fixed to `/ 7.6`, the same divisor
 * `.playtest-main--seats-2`/`.playtest-main--grid` already use for a
 * half-height felt. This pins the real numbers rather than the CSS text,
 * since the bug is in the geometry, not the source.
 */
describe('horde half autoPlace: adjacent rows never overlap', () => {
  // A representative half at 1440×900, halved (~425px tall) — the fixed
  // clamp's floor wins here (56px), same as `measureHordeRect` would read
  // off the live `--pt-card-w`/`--pt-card-h` in that half.
  const cardW = 56;
  const cardH = cardW * 1.4;
  const rect = {
    width: 1440,
    height: 425,
    cardW,
    cardH,
    reservedTop: 0.18,
    reservedBottom: 0.24,
  };

  function bottomOf(y: number): number {
    return y * (rect.height - cardH) + cardH;
  }
  function topOf(y: number): number {
    return y * (rect.height - cardH);
  }

  it('places two horde turns of creatures and a noncreature permanent in non-overlapping boxes', () => {
    let battlefield: BattlefieldCard[] = [];
    const placements: { row: string; y: number }[] = [];

    // Turn 1: a wave of Zombie tokens (creatures row) plus a Bad-Moon-style
    // enchantment (permanents row) — the exact shapes the bug reproduced with.
    const turn1 = [
      card('zombie-1', { isToken: true, typeLine: 'Zombie Creature Token' }),
      card('zombie-2', { isToken: true, typeLine: 'Zombie Creature Token' }),
      card('bad-moon', { typeLine: 'Enchantment' }),
    ];
    // Turn 2: more of the same, the accumulation the report described.
    const turn2 = [
      card('zombie-3', { isToken: true, typeLine: 'Zombie Creature Token' }),
      card('zombie-4', { isToken: true, typeLine: 'Zombie Creature Token' }),
    ];

    for (const c of [...turn1, ...turn2]) {
      const { x, y } = autoPlace(c, battlefield, rect);
      placements.push({ row: c.typeLine!.includes('Enchantment') ? 'permanents' : 'creatures', y });
      battlefield = [...battlefield, bf(c, x, y)];
    }

    const permanentsY = placements.filter((p) => p.row === 'permanents').map((p) => p.y);
    const creaturesY = placements.filter((p) => p.row === 'creatures').map((p) => p.y);
    expect(permanentsY.length).toBeGreaterThan(0);
    expect(creaturesY.length).toBeGreaterThan(0);

    const permanentsBottom = Math.max(...permanentsY.map(bottomOf));
    const creaturesTop = Math.min(...creaturesY.map(topOf));
    expect(permanentsBottom).toBeLessThanOrEqual(creaturesTop);
  });
});

describe('measureHordeRect', () => {
  function fakeEl(width: number, height: number): HTMLElement {
    return {
      getBoundingClientRect: () => ({ width, height }) as DOMRect,
    } as unknown as HTMLElement;
  }

  it('reads the box and the live card size off computed style', () => {
    const el = fakeEl(1440, 425);
    const orig = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((target: Element) =>
      target === el
        ? ({
            getPropertyValue: (prop: string) =>
              prop === '--pt-card-w' ? '56' : prop === '--pt-card-h' ? '78.4' : '',
          } as CSSStyleDeclaration)
        : orig(target)) as typeof getComputedStyle;
    try {
      const rect = measureHordeRect(el);
      expect(rect.width).toBe(1440);
      expect(rect.height).toBe(425);
      expect(rect.cardW).toBe(56);
      expect(rect.cardH).toBe(78.4);
      expect(rect.reservedTop).toBe(0.18);
      expect(rect.reservedBottom).toBe(0.24);
    } finally {
      globalThis.getComputedStyle = orig;
    }
  });
});

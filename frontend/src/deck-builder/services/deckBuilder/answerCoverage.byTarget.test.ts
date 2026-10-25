import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { answerCoverageByTarget } from './answerCoverage';
import { REAL } from './supportRoles.fixtures';

const card = (name: string) => REAL[name] as unknown as ScryfallCard;
const row = (rows: ReturnType<typeof answerCoverageByTarget>, target: string) =>
  rows?.find((r) => r.target === target);

describe('answerCoverageByTarget (real oracle text)', () => {
  const deck = [card('Swords to Plowshares'), card('Beast Within'), card("Tormod's Crypt")];

  it('counts answers per target type, an any-permanent answer for each battlefield class', () => {
    const rows = answerCoverageByTarget(deck, ['W', 'G']);
    expect(row(rows, 'creature')).toMatchObject({ count: 2, instant: 2, durable: 2 });
    expect(row(rows, 'artifact')).toMatchObject({ count: 1, names: ['Beast Within'] });
    expect(row(rows, 'enchantment')).toMatchObject({ count: 1, fillable: true });
    expect(row(rows, 'graveyard')).toMatchObject({ count: 1, names: ["Tormod's Crypt"] });
  });

  it('marks a target the colors cannot fill, so a zero there is not a gap', () => {
    const rows = answerCoverageByTarget(deck, ['R']);
    expect(row(rows, 'enchantment')?.fillable).toBe(false);
    expect(row(rows, 'stack')?.fillable).toBe(false);
    expect(row(rows, 'creature')?.fillable).toBe(true);
  });

  it('is null when nothing classifies as interaction', () => {
    expect(answerCoverageByTarget([card('Sol Ring')], ['W'])).toBeNull();
  });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { groupByStack, readStoredGroupBy, type Row } from './deck-display-rows';

// A Row is wide, but groupByStack reads exactly three things off it: `tags`,
// `card.type_line` (through classifyType) and `qty`. Build the minimum and
// cast, rather than carrying a 30-field fixture that hides what matters.
function row(name: string, typeLine: string, tags: string[] = [], qty = 1): Row {
  return {
    name,
    qty,
    tags,
    card: { name, type_line: typeLine } as unknown as ScryfallCard,
  } as unknown as Row;
}

const titles = (groups: Array<{ title: string }>) => groups.map((g) => g.title);
const total = (groups: Array<{ rows: Row[] }>) =>
  groups.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.qty, 0), 0);

describe('groupByStack', () => {
  it('files a tagged card under its FIRST tag, not its type', () => {
    const groups = groupByStack([row('Brago', 'Legendary Creature', ['Blink', 'Wincon'])]);
    expect(titles(groups)).toEqual(['Blink']);
  });

  it('falls back to the card type when a card has no tags', () => {
    const groups = groupByStack([row('Forest', 'Basic Land'), row('Bear', 'Creature')]);
    expect(titles(groups)).toEqual(['Creature', 'Land']);
  });

  it('is a PARTITION: a multi-tagged card appears exactly once', () => {
    const groups = groupByStack([
      row('Brago', 'Creature', ['Blink', 'Wincon', 'Combo']),
      row('Bear', 'Creature'),
    ]);
    expect(titles(groups)).toEqual(['Blink', 'Creature']);
    // The overlapping 'tag' lens would put Brago in three groups; this must not.
    expect(total(groups)).toBe(2);
  });

  it('section counts sum to the deck, including multi-copy rows', () => {
    const deck = [
      row('Brago', 'Creature', ['Blink'], 1),
      row('Forest', 'Basic Land', [], 36),
      row('Sol Ring', 'Artifact', ['Ramp'], 1),
      row('Bear', 'Creature', [], 4),
    ];
    expect(total(groupByStack(deck))).toBe(42);
  });

  it('orders user stacks alphabetically, then type fallbacks in display order', () => {
    const groups = groupByStack([
      row('Forest', 'Basic Land'),
      row('Bear', 'Creature'),
      row('Sol Ring', 'Artifact', ['Ramp']),
      row('Brainstorm', 'Instant', ['Draw']),
    ]);
    // Tagged stacks lead (Draw, Ramp), then DISPLAY_ORDER puts Creature
    // before Land. Alphabetical would have put Land before Ramp.
    expect(titles(groups)).toEqual(['Draw', 'Ramp', 'Creature', 'Land']);
  });

  it('prepends the commander group, singular or plural', () => {
    const cmd = [row('Brago', 'Legendary Creature')];
    expect(titles(groupByStack([row('Bear', 'Creature')], cmd))[0]).toBe('Commander');
    expect(titles(groupByStack([], [...cmd, row('Sidar', 'Legendary Creature')]))[0]).toBe(
      'Commanders'
    );
  });

  it('merges a tag that collides with a type name into ONE section', () => {
    // Two sections titled "Creature" would be a duplicate React key in both
    // renderers, and two headers reading the same word.
    const groups = groupByStack([
      row('Brago', 'Legendary Creature', ['Creature']),
      row('Bear', 'Creature'),
    ]);
    expect(titles(groups)).toEqual(['Creature']);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].icon).toBe('tag');
  });

  it('merges case-insensitively and keeps the tag casing', () => {
    const groups = groupByStack([row('Bear', 'Creature'), row('Brago', 'Creature', ['CREATURE'])]);
    expect(titles(groups)).toEqual(['CREATURE']);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('returns nothing for an empty deck', () => {
    expect(groupByStack([])).toEqual([]);
  });
});

describe("readStoredGroupBy accepts 'stack'", () => {
  it('round-trips the new lens and still rejects junk', () => {
    localStorage.setItem('mtg-decks-group-by', 'stack');
    expect(readStoredGroupBy()).toBe('stack');
    localStorage.setItem('mtg-decks-group-by', 'nonsense');
    expect(readStoredGroupBy()).toBe('type');
    localStorage.removeItem('mtg-decks-group-by');
  });
});

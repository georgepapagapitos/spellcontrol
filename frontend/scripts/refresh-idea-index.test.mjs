// Pure-part tests for the idea-index refresher: no network, no fs writes.
import { describe, it, expect } from 'vitest';
import {
  aliasesFor,
  buildIdeas,
  creatureTypeOf,
  keepTag,
  singularForms,
  slugOfUrl,
} from './idea-index-lib.mjs';
import { commandersOfTagPage } from './refresh-idea-index.mjs';

const TYPES = [
  'Angel',
  'Elf',
  'Dwarf',
  'Harpy',
  'Mouse',
  'Time Lord',
  'Fungus',
  'Werewolf',
  'Sliver',
];

describe('creature-type matching', () => {
  it('maps plural tag names onto singular types', () => {
    for (const n of [
      'Angels',
      'Elves',
      'Dwarves',
      'Harpies',
      'Mice',
      'Time Lords',
      'Werewolves',
      'Slivers',
    ]) {
      expect(creatureTypeOf(n, TYPES), n).not.toBeNull();
    }
  });
  it('maps Latin plurals', () => {
    expect(singularForms('Fungi')).toContain('fungus');
    expect(creatureTypeOf('Fungi', TYPES)).toBe('Fungus');
    expect(creatureTypeOf('Time Lords', TYPES)).toBe('Time Lord');
  });
  it('leaves ways to play alone', () => {
    for (const n of ['Tokens', 'Landfall', 'Group Hug', '+1/+1 Counters', 'Lifegain']) {
      expect(creatureTypeOf(n, TYPES), n).toBeNull();
    }
  });
});

describe('keepTag', () => {
  it('needs enough decks and enough commanders', () => {
    expect(keepTag({ slug: 'angels', decks: 500, commanders: 5 })).toBe(true);
    expect(keepTag({ slug: 'angels', decks: 499, commanders: 20 })).toBe(false);
    expect(keepTag({ slug: 'angels', decks: 9000, commanders: 4 })).toBe(false);
    expect(keepTag({ slug: 'angels', decks: 9000, commanders: null })).toBe(false);
  });
  it('drops the generic styles', () => {
    for (const slug of ['aggro', 'midrange', 'good-stuff']) {
      expect(keepTag({ slug, decks: 100000, commanders: 24 })).toBe(false);
    }
  });
});

describe('buildIdeas', () => {
  const tags = [
    { name: 'Tokens', url: '/tags/tokens', sanitized: 'parallel-lives', num_decks: 200 + 5000 },
    { name: 'Angels', url: '/tags/angels', sanitized: 'giada', num_decks: 10806 },
    { name: 'Aggro', url: '/tags/aggro', num_decks: 104628 },
    { name: 'Tiny', url: '/tags/tiny', num_decks: 10 },
    { name: 'Thin', url: '/tags/thin', num_decks: 9000 },
  ];
  const pages = new Map([
    ['tokens', { commanders: 23, top: 'Baylen' }],
    ['angels', { commanders: 24, top: 'Giada, Font of Hope' }],
    ['aggro', { commanders: 24, top: 'X' }],
    ['thin', { commanders: 2, top: 'Y' }],
  ]);
  it('classifies, gates and sorts by deck count', () => {
    const { ideas, dropped } = buildIdeas(tags, pages, TYPES);
    expect(ideas.map((i) => [i.slug, i.kind])).toEqual([
      ['angels', 'typal'],
      ['tokens', 'playstyle'],
    ]);
    expect(ideas[0]).toMatchObject({
      type: 'Angel',
      commanders: 24,
      card: 'Giada, Font of Hope',
      decks: 10806,
    });
    expect(dropped).toBe(3);
  });
});

describe('aliases and urls', () => {
  it('keeps aliases only for slugs that survived', () => {
    const a = aliasesFor(['tokens', 'angels']);
    expect(a.tokens).toContain('go wide');
    expect(a.aristocrats).toBeUndefined();
  });
  it('reads the slug off a tag url', () => {
    expect(slugOfUrl('/tags/plus-1-plus-1-counters')).toBe('plus-1-plus-1-counters');
  });
});

describe('commandersOfTagPage', () => {
  const page = (cardviews) => ({
    container: {
      json_dict: {
        cardlists: [
          { tag: 'newcommanders', cardviews: [{ name: 'New' }] },
          { tag: 'topcommanders', cardviews },
        ],
      },
    },
  });
  it('counts the Top Commanders list, not New Commanders, and skips partner pairs', () => {
    expect(commandersOfTagPage(page([{ name: 'A' }, { name: 'B // C' }, { name: 'D' }]))).toEqual({
      commanders: 2,
      top: 'A',
    });
  });
  it('reads an empty page as zero', () => {
    expect(commandersOfTagPage({})).toEqual({ commanders: 0, top: null });
  });
});

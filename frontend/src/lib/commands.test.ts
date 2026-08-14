import { describe, expect, it, vi } from 'vitest';
import type { Deck } from '../store/decks';
import {
  buildCommands,
  flattenGroups,
  matchCommands,
  scoreCommand,
  type Command,
} from './commands';

function deck(id: string, name: string, commander?: string, cardCount = 99): Deck {
  return {
    id,
    name,
    cards: Array.from({ length: cardCount }, () => ({})),
    commander: commander ? ({ name: commander } as Deck['commander']) : null,
  } as Deck;
}

const cmd = (over: Partial<Command> = {}): Command => ({
  id: 'x',
  label: 'Decks',
  group: 'Navigate',
  run: () => {},
  ...over,
});

describe('buildCommands', () => {
  it('offers every deck by name and opens it', () => {
    const go = vi.fn();
    const commands = buildCommands({
      decks: [deck('d1', 'Sac Value', 'Meren of Clan Nel Toth')],
      go,
    });
    const row = commands.find((c) => c.id === 'deck:d1');
    expect(row?.label).toBe('Sac Value');
    row?.run();
    expect(go).toHaveBeenCalledWith('/decks/d1');
  });

  it('hints with the commander only when it is not just the deck name again', () => {
    const commands = buildCommands({
      decks: [
        // Named after its commander — the commander adds nothing, so four
        // sibling decks would otherwise render as four identical rows.
        deck('d1', 'Abigale', 'Abigale, Eloquent First-Year'),
        deck('d2', 'Sac Value', 'Meren of Clan Nel Toth'),
        deck('d3', 'No commander'),
      ],
      go: vi.fn(),
    });
    const hint = (id: string) => commands.find((c) => c.id === id)?.hint;
    expect(hint('deck:d1')).toBe('99 cards');
    expect(hint('deck:d2')).toBe('Meren of Clan Nel Toth · 99 cards');
    expect(hint('deck:d3')).toBe('99 cards');
  });

  it('still finds a deck by its commander even when the hint omits it', () => {
    const commands = buildCommands({
      decks: [deck('d1', 'Abigale', 'Abigale, Eloquent First-Year')],
      go: vi.fn(),
    });
    expect(scoreCommand(commands.find((c) => c.id === 'deck:d1')!, 'eloquent')).toBeGreaterThan(0);
  });

  it('routes the import action through location state, not a bare path', () => {
    const go = vi.fn();
    buildCommands({ decks: [], go })
      .find((c) => c.id === 'action:import-deck')
      ?.run();
    expect(go).toHaveBeenCalledWith('/decks', { openImport: true });
  });

  it('builds a usable surface with no decks at all', () => {
    const commands = buildCommands({ decks: [], go: vi.fn() });
    expect(commands.some((c) => c.group === 'Your decks')).toBe(false);
    expect(commands.some((c) => c.group === 'Navigate')).toBe(true);
    expect(commands.some((c) => c.group === 'Actions')).toBe(true);
  });
});

describe('scoreCommand', () => {
  it('ranks an exact label over a prefix over a word-start over a substring', () => {
    const exact = scoreCommand(cmd({ label: 'Decks' }), 'decks');
    const prefix = scoreCommand(cmd({ label: 'Decks index' }), 'decks');
    const wordStart = scoreCommand(cmd({ label: 'Discover decks' }), 'decks');
    // Mid-word, so no word boundary precedes it — substring tier, not word-start.
    const substring = scoreCommand(cmd({ label: 'Sidedecks' }), 'decks');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it('ranks a label match above a keyword match', () => {
    expect(scoreCommand(cmd({ label: 'Search' }), 'sea')).toBeGreaterThan(
      scoreCommand(cmd({ label: 'Play', keywords: ['season'] }), 'sea')
    );
  });

  it('matches case- and accent-insensitively', () => {
    expect(scoreCommand(cmd({ label: 'Jarád' }), 'JARAD')).toBeGreaterThan(0);
  });

  it('returns 0 for no match, and matches everything on an empty query', () => {
    expect(scoreCommand(cmd({ label: 'Decks' }), 'zzz')).toBe(0);
    expect(scoreCommand(cmd({ label: 'Decks' }), '   ')).toBe(1);
  });

  it('does not treat a regex metacharacter in the query as a pattern', () => {
    expect(scoreCommand(cmd({ label: 'Decks' }), '.*')).toBe(0);
  });
});

describe('matchCommands', () => {
  it('puts the exact page above the longer page that contains it', () => {
    const commands = buildCommands({ decks: [], go: vi.fn() });
    const first = flattenGroups(matchCommands(commands, 'decks'))[0];
    expect(first.label).toBe('Decks');
  });

  it('emits groups in canonical order and drops empty ones', () => {
    const commands = buildCommands({ decks: [deck('d1', 'Decksmith')], go: vi.fn() });
    const groups = matchCommands(commands, 'decks');
    expect(groups.map((g) => g.group)).toEqual(['Navigate', 'Your decks']);
  });

  it('caps each group so one group cannot crowd out the others', () => {
    const decks = Array.from({ length: 20 }, (_, i) => deck(`d${i}`, `Deck ${i}`));
    const groups = matchCommands(buildCommands({ decks, go: vi.fn() }), 'deck', 3);
    for (const g of groups) expect(g.commands.length).toBeLessThanOrEqual(3);
  });

  it('returns nothing when the query matches nothing', () => {
    expect(matchCommands(buildCommands({ decks: [], go: vi.fn() }), 'zzzzz')).toEqual([]);
  });

  it('keeps source order for equal scores on an empty query', () => {
    const commands = buildCommands({ decks: [], go: vi.fn() });
    const flat = flattenGroups(matchCommands(commands, '', 99));
    expect(flat[0].label).toBe('Home');
  });
});

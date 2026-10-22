// @vitest-environment happy-dom
/**
 * E1008: arrowing through the add-cards results says the row's name AND the
 * badges a sighted user reads before pressing Enter (off-color, not legal,
 * in deck, ownership). The status text comes from each badge's own
 * `data-status`, so these run the real rows and read the live region.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/cards/scryfall-catalog', () => ({
  fetchTypeSuggestions: () => Promise.resolve([]),
}));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStats: () => Promise.resolve(null),
}));
const scryfall = (name: string, ci: string[]) => ({
  id: `s-${name}`,
  name,
  color_identity: ci,
  mana_cost: '',
  cmc: 1,
  type_line: 'Artifact',
  legalities: { commander: 'legal' },
});
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: (q: string) =>
    Promise.resolve({
      data: q.includes('ring')
        ? [scryfall('Sol Ring', [])]
        : [scryfall('Sol Ring', []), scryfall('Solemn Offering', ['W'])],
    }),
  getCardByNameResilient: (name: string) => Promise.resolve({ id: name, name }),
}));

function owned(name: string, colorIdentity: string[], legal = 'legal'): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    colorIdentity,
    legalities: { commander: legal },
  } as unknown as EnrichedCard;
}

function renderPanel(opts: { counts?: [string, number][]; limit?: string[] } = {}) {
  render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map(opts.counts ?? [])}
      atCopyLimit={(n) => (opts.limit ?? []).includes(n)}
      onAdd={vi.fn()}
      onClose={() => {}}
      addZone="main"
      enableSuggestions
    />
  );
}

const live = () => document.querySelector('.card-search-panel > .sr-only[aria-live="polite"]');
const arrow = (key: 'ArrowDown' | 'ArrowUp') =>
  fireEvent.keyDown(screen.getByRole('textbox'), { key });
const said = (text: string) => waitFor(() => expect(live()?.textContent).toBe(text));

describe('add-cards keyboard announcement carries the row status (E1008)', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [
        owned('Ancient Tomb', ['R']),
        owned('Lightning Bolt', ['R']),
        owned('Counterspell', ['U']),
        owned('Banned Thing', ['R'], 'banned'),
      ],
    });
  });

  it('Collection: in deck, off-color and not legal rows say so, in the row order', async () => {
    renderPanel({ counts: [['Lightning Bolt', 2]] });
    fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
    // Cards the mainboard can't take sit behind "Show them", flagged on the row.
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    const names = Array.from(document.querySelectorAll<HTMLElement>('[data-result-name]')).map(
      (el) => el.dataset.resultName
    );
    const at = (n: string) => names.indexOf(n);
    expect(at('Lightning Bolt')).toBeGreaterThan(-1);

    // Walk the list so each row is announced once.
    const seen: string[] = [];
    for (let i = 1; i < names.length; i++) {
      arrow('ArrowDown');
      await waitFor(() => expect(live()?.textContent).toContain(`${i + 1} of ${names.length}`));
      seen.push(live()?.textContent ?? '');
    }
    const line = (name: string) => seen.find((t) => t.startsWith(`${name},`)) ?? '';
    expect(line('Lightning Bolt')).toMatch(
      /^Lightning Bolt, owned 1, in deck, 2 copies, \d of \d\. (Last result\. )?Enter adds it\.$/
    );
    expect(line('Banned Thing')).toContain('Banned Thing, Not legal, owned 1');
    expect(line('Counterspell')).toContain('Counterspell, Off-color, owned 1');
    expect(line('Ancient Tomb')).not.toMatch(/Off-color|Not legal|in deck/);
  });

  it('Scryfall: off-color and unowned are spoken before the position', async () => {
    renderPanel({ counts: [['Sol Ring', 1]] });
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sol' } });
    await screen.findByText('Solemn Offering');

    arrow('ArrowDown');
    await said('Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it.');
    arrow('ArrowUp');
    await said('Sol Ring, Unowned, in deck, 1 copy, 1 of 2. Enter adds it.');
    arrow('ArrowUp');
    await said('Sol Ring, Unowned, in deck, 1 copy, 1 of 2. First result. Enter adds it.');
  });

  it('the first arrow press is announced even if it lands the instant the rows appear', async () => {
    // A passive effect would publish the list to the Arrow handler a task after
    // the rows hit the DOM; a press in that gap (a MutationObserver callback
    // runs in it) was dropped silently. The publish must be in the commit.
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sol' } });
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-result-name]')) return;
        observer.disconnect();
        arrow('ArrowDown');
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await said('Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it.');
  });

  it('a row at its copy limit says Enter will not add it', async () => {
    renderPanel({ counts: [['Sol Ring', 1]], limit: ['Sol Ring'] });
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sol' } });
    await screen.findByText('Solemn Offering');
    arrow('ArrowUp');
    await said('Sol Ring, Unowned, in deck, 1 copy, 1 of 2. First result. At its copy limit.');
  });

  it('pressing the same arrow at the end re-announces after the live region is emptied', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'sol' } });
    await screen.findByText('Solemn Offering');
    arrow('ArrowDown');
    await waitFor(() => expect(live()?.textContent).toContain('2 of 2'));
    arrow('ArrowDown');
    expect(live()?.textContent).toBe('');
    await waitFor(() => expect(live()?.textContent).toContain('2 of 2'));
  });
});

/**
 * Every non-empty text the live region shows, in order. The region is emptied
 * before each refill, so one entry is one announcement.
 */
function recordLive(): string[] {
  const seen: string[] = [];
  const node = live();
  if (!node) throw new Error('no live region');
  new MutationObserver(() => {
    const text = node.textContent ?? '';
    if (text) seen.push(text);
  }).observe(node, { childList: true, characterData: true, subtree: true });
  return seen;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const type = (value: string) =>
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) =>
  fireEvent.keyDown(screen.getByRole('textbox'), { key: k, ...mods });

describe('add-cards results speak their count and highlighted row once they settle (E1008)', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [owned('Ancient Tomb', ['R']), owned('Lightning Bolt', ['R'])],
    });
  });

  async function scryfallTab() {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Scryfall/ }));
    // Let the tab switch's own settle pass ("type two characters" says nothing).
    await wait(700);
  }

  it('a typed query is spoken once, as the count then the top row Enter would add', async () => {
    await scryfallTab();
    const seen = recordLive();
    type('s');
    type('so');
    type('sol');
    await screen.findByText('Solemn Offering');
    await waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000 });
    await wait(700);
    expect(seen).toEqual(['2 results. Sol Ring, Unowned, 1 of 2. Enter adds it.']);
  });

  it('a single result is the only result whichever way the arrow goes', async () => {
    await scryfallTab();
    const seen = recordLive();
    type('sol ring');
    await waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000 });
    expect(seen[0]).toBe('Sol Ring, Unowned, only result. Enter adds it.');
    key('ArrowDown');
    await waitFor(() => expect(seen).toHaveLength(2));
    key('ArrowUp');
    await waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.slice(1)).toEqual([
      'Sol Ring, Unowned, only result. Enter adds it.',
      'Sol Ring, Unowned, only result. Enter adds it.',
    ]);
  });

  it('an arrow press before the list settles takes over: no count talks over it', async () => {
    await scryfallTab();
    const seen = recordLive();
    type('sol');
    await screen.findByText('Solemn Offering');
    key('ArrowDown');
    await wait(900);
    expect(seen).toEqual(['Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it.']);
  });

  it('Ctrl+End and Ctrl+Home jump to the ends; plain Home/End stay with the caret', async () => {
    await scryfallTab();
    type('sol');
    await screen.findByText('Solemn Offering');
    const seen = recordLive();
    key('End', { ctrlKey: true });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBe('Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it.');
    key('Home', { metaKey: true });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toBe('Sol Ring, Unowned, 1 of 2. Enter adds it.');
    // With text in the box, plain Home/End move the caret: not prevented, not spoken.
    expect(key('End')).toBe(true);
    expect(key('Home')).toBe(true);
    await wait(300);
    expect(seen).toHaveLength(2);
  });

  it('with the box empty, plain End and Home jump too (there is no caret to move)', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
    await waitFor(() => expect(live()?.textContent).toMatch(/^2 results\. /), { timeout: 2000 });
    const seen = recordLive();
    expect(key('End')).toBe(false);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatch(/, 2 of 2\. Enter adds it\.$/);
    expect(key('Home')).toBe(false);
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toMatch(/, 1 of 2\. Enter adds it\.$/);
  });

  it('a query with no matches says so', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
    type('zzzz');
    await waitFor(() => expect(live()?.textContent).toBe('No results.'), { timeout: 2000 });
  });
});

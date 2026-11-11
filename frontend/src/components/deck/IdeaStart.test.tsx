// @vitest-environment happy-dom
/**
 * "What do you want to build?" (E1112): the closed idea list searched and browsed, the commander
 * names it also offers, the no-match state, and the load failure.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '@/types/index';

const { fetchAllCommanderNames } = vi.hoisted(() => ({ fetchAllCommanderNames: vi.fn() }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({ fetchAllCommanderNames }));
vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

import { __resetIdeaIndexForTests } from '@/lib/deck/idea-index';
import { useCollectionStore } from '@/store/collection';
import { IdeaStart } from './IdeaStart';

const idea = (slug: string, name: string, kind: string, decks: number, type?: string) => ({
  slug,
  name,
  kind,
  decks,
  commanders: 20,
  card: `${name} card`,
  ...(type ? { type } : {}),
});
const SNAPSHOT = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  aliases: { 'extra-turns': ['time travel'] },
  ideas: [
    idea('tokens', 'Tokens', 'playstyle', 208753),
    idea('angels', 'Angels', 'typal', 10806, 'Angel'),
    idea('elves', 'Elves', 'typal', 16158, 'Elf'),
    idea('landfall', 'Landfall', 'playstyle', 22686),
    idea('extra-turns', 'Extra Turns', 'playstyle', 10853),
    idea('time-lords', 'Time Lords', 'typal', 503, 'Time Lord'),
  ],
};

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderStart(onPickCommander = vi.fn(async () => {})) {
  render(
    <MemoryRouter initialEntries={['/decks/new/generate']}>
      <Routes>
        <Route
          path="/decks/new/generate"
          element={<IdeaStart format="commander" onPickCommander={onPickCommander} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return onPickCommander;
}

const searchBox = () => screen.getByRole('combobox', { name: 'Search deck ideas and commanders' });

beforeEach(() => {
  __resetIdeaIndexForTests();
  useCollectionStore.setState({ cards: [] });
  fetchAllCommanderNames.mockReset();
  fetchAllCommanderNames.mockResolvedValue(['Giada, Font of Hope', 'Lyra Dawnbringer']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(SNAPSHOT)))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('IdeaStart browse', () => {
  it('shows the shelves once the snapshot loads, each tile a link to its idea', async () => {
    renderStart();
    expect(screen.getByRole('status').textContent).toContain('Loading ideas');
    const types = await screen.findByRole('region', { name: 'Creature types' });
    expect(
      within(types)
        .getAllByRole('link')
        .map((l) => l.textContent)
    ).toEqual([
      expect.stringContaining('Elves'),
      expect.stringContaining('Angels'),
      expect.stringContaining('Time Lords'),
    ]);
    const angels = within(types).getByRole('link', { name: /Angels/ });
    expect(angels.getAttribute('href')).toBe('/decks/new/generate/idea/angels?format=commander');
    expect(
      within(screen.getByRole('region', { name: 'Ways to play' })).getAllByRole('link')
    ).toHaveLength(3);
    expect(screen.queryByRole('region', { name: 'Your collection could build' })).toBeNull();
  });

  it('offers the collection shelf only when it holds enough of a type', async () => {
    const angel = (i: number) =>
      ({ copyId: `a${i}`, name: `Angel ${i}`, typeLine: 'Creature — Angel' }) as EnrichedCard;
    const filler = (i: number) =>
      ({ copyId: `f${i}`, name: `Filler ${i}`, typeLine: 'Instant' }) as EnrichedCard;
    useCollectionStore.setState({
      cards: [
        ...Array.from({ length: 14 }, (_, i) => angel(i)),
        ...Array.from({ length: 10 }, (_, i) => filler(i)),
      ],
    });
    renderStart();
    const shelf = await screen.findByRole('region', { name: 'Your collection could build' });
    expect(within(shelf).getByRole('link', { name: /Angels/ }).textContent).toContain('You own 14');
  });

  it('lists every idea behind the toggle', async () => {
    renderStart();
    const toggle = await screen.findByRole('button', { name: 'Browse every idea (6)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Landfall' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the full list' }));
    expect(screen.queryByRole('link', { name: 'Landfall' })).toBeNull();
  });

  it('says so and offers Retry when the snapshot will not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    renderStart();
    expect(await screen.findByText(/Couldn't load the deck ideas/)).toBeTruthy();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(SNAPSHOT)))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Creature types' })).toBeTruthy();
  });
});

describe('IdeaStart search', () => {
  async function typeInto(text: string) {
    await screen.findByRole('region', { name: 'Creature types' });
    await waitFor(() => expect(fetchAllCommanderNames).toHaveBeenCalled());
    fireEvent.change(searchBox(), { target: { value: text } });
  }

  it('wires the combobox: grouped listbox, arrow keys move aria-activedescendant', async () => {
    renderStart();
    await typeInto('time');
    const box = searchBox();
    const list = screen.getByRole('listbox', { name: 'Deck ideas and commanders' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(within(list).getByRole('group', { name: 'Deck ideas' })).toBeTruthy();
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Extra Turns'),
      expect.stringContaining('Time Lords'),
    ]);
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
  });

  it('Enter opens the highlighted idea, else the top result', async () => {
    renderStart();
    await typeInto('ang');
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect((await screen.findByTestId('where')).textContent).toBe(
      '/decks/new/generate/idea/angels?format=commander'
    );
  });

  it('a click on an option opens it', async () => {
    renderStart();
    await typeInto('time');
    fireEvent.mouseEnter(screen.getByRole('option', { name: /Time Lords/ }));
    fireEvent.mouseDown(screen.getByRole('option', { name: /Time Lords/ }));
    expect((await screen.findByTestId('where')).textContent).toContain('/idea/time-lords');
  });

  it('Escape closes the list', async () => {
    renderStart();
    await typeInto('ang');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a click outside closes the list', async () => {
    renderStart();
    await typeInto('ang');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('also offers commander names, and picking one hands the name to the page', async () => {
    const onPick = renderStart();
    await typeInto('giada');
    const group = screen.getByRole('group', { name: 'Commanders' });
    fireEvent.mouseDown(within(group).getByRole('option', { name: /Giada, Font of Hope/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('Giada, Font of Hope'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks a commander the collection holds', async () => {
    useCollectionStore.setState({
      cards: [{ copyId: 'g', name: 'Giada, Font of Hope' } as EnrichedCard],
    });
    renderStart();
    await typeInto('giada');
    expect(screen.getByRole('option', { name: /Giada/ }).textContent).toContain('In collection');
  });

  it('says when a commander cannot be loaded', async () => {
    renderStart(vi.fn(async () => Promise.reject(new Error('404'))));
    await typeInto('lyra');
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't load Lyra Dawnbringer. Try again."
    );
  });

  it('still searches ideas when the commander list will not load', async () => {
    fetchAllCommanderNames.mockRejectedValue(new Error('down'));
    renderStart();
    await typeInto('ang');
    expect(screen.getByRole('option', { name: /Angels/ })).toBeTruthy();
  });

  it('with no match, names the closest ideas and offers to browse them all', async () => {
    renderStart();
    await typeInto('time warp');
    expect(
      screen.getByText('No deck idea called “time warp”. These are the closest.')
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: /Extra Turns/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Browse every idea' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Landfall' })).toBeTruthy();
  });

  it('with nothing close at all, offers the popular ideas instead', async () => {
    renderStart();
    await typeInto('qqq');
    expect(screen.getByText('No deck idea called “qqq”. These are popular instead.')).toBeTruthy();
    expect(screen.getAllByRole('option')[0].textContent).toContain('Tokens');
  });

  it('Enter with an empty box does nothing', async () => {
    renderStart();
    await screen.findByRole('region', { name: 'Creature types' });
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

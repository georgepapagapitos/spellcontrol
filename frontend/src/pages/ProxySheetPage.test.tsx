// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore, type Deck, type DeckCard } from '@/store/decks';
import { ProxySheetPage } from './ProxySheetPage';

vi.mock('./ProxySheetPage.css', () => ({}));

function card(name: string): ScryfallCard {
  return {
    name,
    image_uris: { large: `https://cards.scryfall.io/large/${encodeURIComponent(name)}.jpg` },
  } as unknown as ScryfallCard;
}

let n = 0;
function slot(name: string, allocatedCopyId: string | null = null): DeckCard {
  n += 1;
  return { slotId: `s${n}`, card: card(name), allocatedCopyId };
}

function deck(cards: DeckCard[], extra: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Krenko',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    ...extra,
  } as unknown as Deck;
}

function seed(d: Deck | null) {
  useDecksStore.setState({ decks: d ? [d] : [], hydrated: true } as never);
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/decks/d1/proxies']}>
      <Routes>
        <Route path="/decks/:id/proxies" element={<ProxySheetPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const printButton = () => screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  useCollectionStore.setState({
    cards: [{ copyId: 'owned-1', name: 'Goblin Guide' }],
    hydrating: false,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe('ProxySheetPage', () => {
  it('defaults to the missing cards when the deck has any', () => {
    seed(deck([slot('Sol Ring'), slot('Goblin Guide', 'owned-1'), slot('Mountain')]));
    mount();
    const missing = screen.getByRole('radio', { name: 'Missing · 1' }) as HTMLInputElement;
    expect(missing.checked).toBe(true);
    expect(screen.getByText('1 card · 1 page')).toBeTruthy();
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['Sol Ring']);

    fireEvent.click(screen.getByRole('radio', { name: 'Whole deck · 2' }));
    expect(screen.getByText('2 cards · 1 page')).toBeTruthy();
  });

  it('prints the whole deck with no choice when nothing is missing', () => {
    seed(deck([slot('Goblin Guide', 'owned-1')]));
    mount();
    expect(screen.queryByRole('group', { name: 'Cards to print' })).toBeNull();
    expect(screen.getByText('1 card · 1 page')).toBeTruthy();
  });

  it('says so when only basics are left, and the button brings them back', () => {
    seed(deck([slot('Mountain'), slot('Mountain')]));
    mount();
    expect(screen.getByText('Only basic lands to print.')).toBeTruthy();
    expect(printButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Include basic lands' }));
    expect(screen.getByText('2 cards · 1 page')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('keeps Print disabled until every image has loaded or failed', () => {
    // happy-dom has no window.print.
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true });
    seed(deck([slot('Sol Ring'), slot('Arcane Signet'), slot('Opt')]));
    mount();
    expect(printButton().disabled).toBe(true);
    expect(screen.getByText('Loading images · 0 of 3')).toBeTruthy();

    const [first, second, third] = screen.getAllByRole('img');
    fireEvent.load(first);
    fireEvent.load(second);
    expect(printButton().disabled).toBe(true);
    expect(screen.getByText('Loading images · 2 of 3')).toBeTruthy();

    fireEvent.error(third);
    expect(printButton().disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain(
      "1 image didn't load. It prints as a name-only card."
    );

    fireEvent.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);

    // Retry reloads the failed image under a fresh URL and gates Print again.
    fireEvent.click(screen.getByRole('button', { name: 'Retry Sol Ring' }));
    expect(printButton().disabled).toBe(true);
    const retried = screen.getByRole('img', { name: 'Sol Ring' });
    expect(retried.getAttribute('src')).toContain('retry=1');
  });

  it('prints the back face of a double-faced card right after the front', () => {
    const delver = {
      name: 'Delver of Secrets // Insectile Aberration',
      card_faces: [
        { name: 'Delver of Secrets', type_line: 'Creature', image_uris: { large: 'f.jpg' } },
        { name: 'Insectile Aberration', type_line: 'Creature', image_uris: { large: 'b.jpg' } },
      ],
    } as unknown as ScryfallCard;
    seed(deck([{ slotId: 'x', card: delver, allocatedCopyId: null }]));
    mount();
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual([
      'Delver of Secrets',
      'Insectile Aberration, back face',
    ]);
    expect(screen.getByText('1 card · 1 back face · 1 page')).toBeTruthy();
  });

  it('offers the sideboard only when the deck has one', () => {
    seed(deck([slot('Sol Ring')], { sideboard: [slot('Pyroblast')] }));
    mount();
    fireEvent.click(screen.getByRole('switch', { name: 'Include sideboard' }));
    expect(screen.getByText('2 cards · 1 page')).toBeTruthy();
  });

  it('shows an empty deck its way back', () => {
    seed(deck([]));
    mount();
    expect(screen.getByText('Nothing to print.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to deck' }).getAttribute('href')).toBe(
      '/decks/d1'
    );
  });

  it('says when the deck does not exist', () => {
    seed(null);
    mount();
    expect(screen.getByRole('heading', { name: 'That deck no longer exists.' })).toBeTruthy();
  });

  it('holds a skeleton while the collection is still loading', () => {
    seed(deck([slot('Sol Ring')]));
    useCollectionStore.setState({ hydrating: true } as never);
    mount();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('lays out pages by the print settings and keeps them for next time', () => {
    seed(deck(Array.from({ length: 9 }, (_, i) => slot(`Card ${i}`))));
    mount();
    expect(screen.getByText('9 cards · 1 page')).toBeTruthy();

    // A 1 mm bleed costs Letter a row at real size, and the page says how to win it back.
    fireEvent.click(screen.getByRole('switch', { name: /^Bleed/ }));
    expect(screen.getByText('9 cards · 2 pages')).toBeTruthy();
    expect(
      screen.getByText('6 cards fit a page with these settings. At 97% scale, 9 fit.')
    ).toBeTruthy();

    cleanup();
    mount();
    expect(screen.getByRole('switch', { name: /^Bleed/ }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(screen.getByText('9 cards · 2 pages')).toBeTruthy();
  });

  it('marks each card and adds a decklist page when asked', () => {
    seed(
      deck([slot('Sol Ring'), slot('Sol Ring'), slot('Opt')], {
        commander: card('Krenko, Mob Boss'),
      })
    );
    mount();
    fireEvent.click(screen.getByRole('switch', { name: /^Playtest watermark/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Black corners/ }));
    const preview = screen.getByRole('listitem', { name: 'Page 1 of 1' });
    expect(preview.querySelectorAll('.proxy-watermark')).toHaveLength(4);
    expect(preview.querySelectorAll('.proxy-corners')).toHaveLength(4);

    fireEvent.click(screen.getByRole('switch', { name: /^Print decklist/ }));
    expect(screen.getByText('4 cards · 2 pages')).toBeTruthy();
    const list = screen.getByRole('listitem', { name: 'Decklist page' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '1 Krenko, Mob Boss',
      '1 Opt',
      '2 Sol Ring',
    ]);
  });
});

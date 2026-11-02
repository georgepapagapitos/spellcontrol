// @vitest-environment happy-dom
/**
 * BracketCheckerPage (E1090): the public paste-a-list checker. Pins the
 * signed-out flow end to end on mocked endpoints: paste, the card lookup, the
 * commander pick, the estimate with its evidence, the Game Changers list with
 * its as-of date, the error and combo-failure states, and Save to my decks.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_CHANGERS_AS_OF } from '@spellcontrol/deck-metrics';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '@/types/index';
import { GAME_CHANGERS_LIST } from '@/lib/deck-analysis/bracket-check';
import { useDecksStore } from '@/store/decks';
import { pending } from '@/test/pending';

const h = vi.hoisted(() => ({
  importDeckText: vi.fn(),
  matchCombos: vi.fn(),
  loadTaggerData: vi.fn(),
  hasTaggerData: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  importDeckText: h.importDeckText,
}));
vi.mock('@/lib/api/combos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/combos')>()),
  matchCombos: h.matchCombos,
}));
vi.mock('@/deck-builder/services/tagger/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/tagger/client')>()),
  loadTaggerData: h.loadTaggerData,
  hasTaggerData: h.hasTaggerData,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));

import { BracketCheckerPage } from './BracketCheckerPage';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oid-${name}`,
    name,
    cmc: 3,
    type_line: 'Sorcery',
    oracle_text: '',
    color_identity: [],
    legalities: { commander: 'legal' },
    layout: 'normal',
    ...over,
  } as ScryfallCard;
}

const legend = (name: string) =>
  card(name, { type_line: 'Legendary Creature — Elf Druid', color_identity: ['G'] });

function parsed(over: Partial<DeckImportResponse> = {}): DeckImportResponse {
  const cards = [
    legend('Lead Legend'),
    card(GAME_CHANGERS_LIST[0]),
    ...Array.from({ length: 40 }, (_, i) => card(`Filler ${i}`)),
  ];
  return {
    commander: null,
    companion: null,
    cards,
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: cards.length,
    ...over,
  };
}

const NO_COMBOS = { inDeck: [], oneAway: [], almostInCollection: [], source: 'server' };

function renderPage() {
  return render(
    <MemoryRouter>
      <BracketCheckerPage />
    </MemoryRouter>
  );
}

/** The estimate's headline, once the combo check and the estimate have landed. */
async function headline(): Promise<string> {
  return waitFor(() => {
    const el = document.querySelector('.bracket-check-hero-bracket');
    if (!el) throw new Error('no estimate yet');
    return el.textContent ?? '';
  });
}

function noEstimate() {
  expect(document.querySelector('.bracket-check-hero-bracket')).toBeNull();
}

async function submit(text = '1 Sol Ring') {
  fireEvent.change(screen.getByLabelText('Decklist'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Check bracket' }));
}

beforeEach(() => {
  h.importDeckText.mockResolvedValue(parsed());
  h.matchCombos.mockResolvedValue(NO_COMBOS);
  h.loadTaggerData.mockResolvedValue({ generatedAt: '2026-01-01', tags: {} });
  h.hasTaggerData.mockReturnValue(true);
  useDecksStore.setState({ decks: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BracketCheckerPage', () => {
  it('shows the Game Changers list with its as-of date and the FAQ before anything is pasted', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Commander bracket checker' })).toBeTruthy();
    expect(screen.getByText(/Last checked against the Rules Committee/).textContent).toContain(
      'February 9, 2026'
    );
    expect(GAME_CHANGERS_AS_OF).toBe('2026-02-09');
    expect(screen.getByText(GAME_CHANGERS_LIST[0])).toBeTruthy();
    expect(screen.getByText('Do I need an account?')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'How the estimate is made and checked' })
        .getAttribute('href')
    ).toBe('/guides/bracket-estimator.html');
    // No estimate, and nothing asks for an account.
    expect(screen.queryByText('Your estimate')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Check bracket' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('reads a list, preselects the only legendary creature and shows the estimate and evidence', async () => {
    renderPage();
    await submit();
    expect(await headline()).toContain('Bracket 3');
    expect(h.importDeckText).toHaveBeenCalledWith('1 Sol Ring');
    expect(h.loadTaggerData).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Commander/ }).textContent).toContain('Lead Legend');
    expect(screen.getByText(/1 is in your list/)).toBeTruthy();
    expect(screen.getByText(/\(in your list\)/)).toBeTruthy();
    // The evidence panel is the deck view's own.
    expect(document.querySelector('.bracket-breakdown')).not.toBeNull();
    // The combo match was the public endpoint, with no collection.
    expect(h.matchCombos).toHaveBeenCalledWith(
      expect.objectContaining({ ownedOracleIds: [], format: 'commander' })
    );
  });

  it('asks for the commander when the list has several legends, and estimates after the pick', async () => {
    h.importDeckText.mockResolvedValue(
      parsed({ cards: [legend('First Legend'), legend('Second Legend'), card('Sol Ring')] })
    );
    renderPage();
    await submit();
    const picker = await screen.findByRole('button', { name: /Commander/ });
    expect(picker.textContent).toContain('Pick a commander');
    noEstimate();
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: 'Second Legend' }));
    expect(await headline()).toMatch(/Bracket \d/);
  });

  it('says so when the list has no legendary creature', async () => {
    h.importDeckText.mockResolvedValue(parsed({ cards: [card('Sol Ring')] }));
    renderPage();
    await submit();
    expect(await screen.findByText(/No legendary creature in this list/)).toBeTruthy();
    noEstimate();
  });

  it('keeps the pasted text and offers Retry when the lookup fails', async () => {
    h.importDeckText.mockRejectedValueOnce(new Error('Failed to fetch'));
    renderPage();
    await submit('1 Sol Ring');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't read that list");
    expect((screen.getByLabelText('Decklist') as HTMLTextAreaElement).value).toBe('1 Sol Ring');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await headline()).toContain('Bracket 3');
  });

  it('refuses to guess when the tag data did not load', async () => {
    h.hasTaggerData.mockReturnValue(false);
    renderPage();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the card data");
    noEstimate();
  });

  it('shows a busy state while reading', async () => {
    h.importDeckText.mockReturnValue(pending());
    renderPage();
    await submit();
    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Reading your list');
  });

  it('marks the estimate as a floor and offers a retry when the combo match fails', async () => {
    h.matchCombos.mockRejectedValue(new Error('Failed to fetch'));
    renderPage();
    await submit();
    expect(await screen.findByText('At least')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry combos' })).toBeTruthy();
  });

  it('lists the cards it could not find', async () => {
    h.importDeckText.mockResolvedValue(parsed({ unresolvedNames: ['Not A Card'] }));
    renderPage();
    await submit();
    expect(
      await screen.findByText(/1 card couldn't be found and is left out: Not A Card/)
    ).toBeTruthy();
  });

  it('saves the list as a private deck on this device and opens it', async () => {
    renderPage();
    await submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Save to my decks' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    const decks = useDecksStore.getState().decks;
    expect(decks).toHaveLength(1);
    expect(decks[0].commander?.name).toBe('Lead Legend');
    expect(h.navigate).toHaveBeenCalledWith(`/decks/${decks[0].id}`);
  });
});

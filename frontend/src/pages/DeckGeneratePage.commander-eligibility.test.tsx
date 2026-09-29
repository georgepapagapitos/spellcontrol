// @vitest-environment happy-dom
/**
 * E530, USER RULING 2026-09-29: a commander the format won't accept refuses
 * to build and says why. The build bar is where the page already holds the
 * buttons for a missing color choice, so the reason goes there and both
 * buttons wait. The generator's entry throws the same sentence.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => vi.fn() };
});
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'id' }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'authed' }),
}));
vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
// The land pre-fetch would outlive these synchronous tests (see the note in
// DeckGeneratePage.choose-color.test.tsx).
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
}));

vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
vi.mock('../components/deck/CommanderProfileCard', () => ({ CommanderProfileCard: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => null,
}));
vi.mock('../components/deck/ThemePicker', () => ({ ThemePicker: () => null }));
vi.mock('../components/deck/DeckCustomizer', () => ({ DeckCustomizer: () => null }));
vi.mock('../components/deck/GenerationModePicker', () => ({ GenerationModePicker: () => null }));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));

import { DeckGeneratePage } from './DeckGeneratePage';
import { useDeckBuilderStore } from '@/deck-builder/store';

// Real Scryfall objects the live stress panel resolved.
const here = dirname(fileURLToPath(import.meta.url));
const CARDS = new Map<string, ScryfallCard>();
for (const file of ['commander-cards.fixture.json', 'invariant-cards.fixture.json']) {
  const { cards } = JSON.parse(
    readFileSync(resolve(here, '../deck-builder/services/deckBuilder/__fixtures__', file), 'utf8')
  ) as { cards: ScryfallCard[] };
  for (const c of cards) CARDS.set(c.name, c);
}
const real = (name: string) => structuredClone(CARDS.get(name)!);

function renderWith(commander: ScryfallCard, format?: string) {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/decks/new/generate',
          search: format ? `?format=${format}` : '',
          state: { prefill: { commander } },
        },
      ]}
    >
      <DeckGeneratePage />
    </MemoryRouter>
  );
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const bar = () => screen.getByRole('group', { name: 'Build this deck' });

describe('DeckGeneratePage commander eligibility', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
  });

  it('holds both buttons and names why for a commander that is not legendary', () => {
    renderWith(real('Llanowar Elves'));
    expect(bar().textContent).toContain(
      "Llanowar Elves isn't a legendary creature, so it can't be your commander."
    );
    expect(button('Generate deck').disabled).toBe(true);
    expect(button('Start blank').disabled).toBe(true);
  });

  it('holds them for Atraxa in Pauper Commander, and not in Commander', () => {
    renderWith(real("Atraxa, Praetors' Voice"), 'paupercommander');
    expect(bar().textContent).toContain(
      "Atraxa, Praetors' Voice isn't an uncommon creature, so it can't lead a Pauper Commander deck."
    );
    expect(button('Generate deck').disabled).toBe(true);
    expect(button('Start blank').disabled).toBe(true);
  });

  it('builds for a legal commander, with the recap in the bar', () => {
    renderWith(real('Lutri, the Spellchaser'));
    expect(bar().textContent).not.toContain("can't");
    expect(button('Generate deck').disabled).toBe(false);
    expect(button('Start blank').disabled).toBe(false);
  });
});

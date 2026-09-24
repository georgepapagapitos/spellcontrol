// @vitest-environment happy-dom
/**
 * Choose-a-color commanders (The Prismatic Piper, Clara Oswald, Faceless One)
 * have an empty color identity until the player picks one. Building before
 * that would make a colorless deck, so both build buttons wait for the pick.
 */
import 'fake-indexeddb/auto';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Setting a commander makes useDeckGeneration pre-fetch EDHREC data (see the
// "Pre-fetch the EDHREC land suggestion" effect in use-deck-generation.ts).
// These tests are synchronous, so that promise settles AFTER the test ends —
// against the suite's global fetch guard it rejects into teardown, which vitest
// reports as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog"
// was pending` and fails the whole run even though every test passed. Stub it:
// this file is about the prefill ordering contract, not about EDHREC.
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
}));

vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
vi.mock('../components/deck/CommanderProfileCard', () => ({ CommanderProfileCard: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => null,
}));
vi.mock('../components/deck/ThemePicker', () => ({ ThemePicker: () => null }));
vi.mock('../components/deck/DeckCustomizer', () => ({ DeckCustomizer: () => null }));
vi.mock('../components/deck/GenerationModePicker', () => ({ GenerationModePicker: () => null }));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));

import { fireEvent, screen } from '@testing-library/react';
import { DeckNewPage } from './DeckNewPage';
import { useDeckBuilderStore } from '@/deck-builder/store';

const piper = {
  id: 'piper',
  name: 'The Prismatic Piper',
  color_identity: [],
  keywords: ['Partner'],
  type_line: 'Legendary Creature — Shapeshifter',
  oracle_text:
    'If The Prismatic Piper is your commander, choose a color before the game begins. The Prismatic Piper is the chosen color.\nPartner (You can have two commanders if both have partner.)',
};

describe('DeckNewPage choose-a-color commander', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
  });

  it('holds both build buttons until a color is chosen, then builds in that color', () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/decks/new', state: { prefill: { commander: piper } } }]}
      >
        <DeckNewPage />
      </MemoryRouter>
    );

    expect(
      (screen.getByRole('button', { name: 'Generate deck' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Start blank' }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));

    expect(useDeckBuilderStore.getState().colorIdentity).toEqual(['R']);
    expect(useDeckBuilderStore.getState().commander?.color_identity).toEqual(['R']);
    expect(
      (screen.getByRole('button', { name: 'Generate deck' }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Start blank' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});

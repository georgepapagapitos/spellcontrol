// @vitest-environment happy-dom
/**
 * The prefill contract, which two callers share with different shapes:
 * Regenerate (full settings) and the combo seed (commander + must-includes
 * only). The ordering assertion below is the point of this file — see the
 * "ORDER IS LOAD-BEARING" comment in DeckNewPage.
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

import { screen } from '@testing-library/react';
import { DeckNewPage } from './DeckNewPage';
import { useDeckBuilderStore } from '@/deck-builder/store';

function renderWithPrefill(prefill: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/decks/new', state: { prefill } }]}>
      <DeckNewPage />
    </MemoryRouter>
  );
}

const commander = {
  id: 'kess',
  name: 'Kess, Dissident Mage',
  color_identity: ['U', 'B', 'R'],
  type_line: 'Legendary Creature — Human Wizard',
};

describe('DeckNewPage prefill', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
  });

  it('keeps combo must-includes, which setCommander would otherwise clear', () => {
    renderWithPrefill({
      commander,
      mustIncludeCards: ["Thassa's Oracle", 'Demonic Consultation'],
    });

    const { commander: setCmdr, customization } = useDeckBuilderStore.getState();
    expect(setCmdr?.name).toBe('Kess, Dissident Mage');
    // The load-bearing assertion: setCommander() wipes mustIncludeCards, so
    // these only survive because they're written after it.
    expect(customization.mustIncludeCards).toEqual(["Thassa's Oracle", 'Demonic Consultation']);
  });

  it('leaves regenerate-only settings at their defaults when a combo seed omits them', () => {
    const before = useDeckBuilderStore.getState().customization;
    const defaults = {
      targetBracket: before.targetBracket,
      landCount: before.landCount,
      collectionMode: before.collectionMode,
    };

    renderWithPrefill({ commander, mustIncludeCards: ['Sol Ring'] });

    const after = useDeckBuilderStore.getState().customization;
    // Absent must mean "leave it alone", not "reset to undefined/zero".
    expect(after.targetBracket).toBe(defaults.targetBracket);
    expect(after.landCount).toBe(defaults.landCount);
    expect(after.collectionMode).toBe(defaults.collectionMode);
  });

  it('discloses the combo a build was seeded from (E215), before any scrolling', () => {
    renderWithPrefill({
      commander,
      mustIncludeCards: ["Thassa's Oracle", 'Demonic Consultation'],
      comboContext: {
        pieceNames: ["Thassa's Oracle", 'Demonic Consultation'],
        produces: ['Win the game'],
      },
    });

    expect(screen.getByText('Building around a combo')).toBeTruthy();
    expect(screen.getByText("Thassa's Oracle + Demonic Consultation")).toBeTruthy();
    expect(screen.getByText('Win the game')).toBeTruthy();
  });

  it('renders no combo disclosure on a plain new-deck visit (the common case)', () => {
    renderWithPrefill(undefined);
    expect(screen.queryByText('Building around a combo')).not.toBeTruthy();
  });

  it('renders no combo disclosure for a regenerate prefill, which has no comboContext', () => {
    renderWithPrefill({ commander, targetBracket: 3, landCount: 36, collectionMode: true });
    expect(screen.queryByText('Building around a combo')).not.toBeTruthy();
  });

  it('still applies a full regenerate prefill', () => {
    renderWithPrefill({
      commander,
      themes: [],
      targetBracket: 3,
      landCount: 36,
      collectionMode: true,
    });

    const c = useDeckBuilderStore.getState().customization;
    expect(c.targetBracket).toBe(3);
    expect(c.landCount).toBe(36);
    expect(c.collectionMode).toBe(true);
  });
});

// @vitest-environment happy-dom
/**
 * E479: the generator stamps the page's format into the build settings through
 * Fill's fillFormatSettings, so Brawl from /decks/new builds the 60-card deck
 * with brawl legality, and Commander / Pauper Commander keep the 99-card
 * defaults.
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
vi.mock('@/lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));

// Setting a commander makes useDeckGeneration pre-fetch EDHREC data ( see the
// "Pre-fetch the EDHREC land suggestion" effect in use-deck-generation.ts).
// These tests are synchronous, so that promise settles AFTER the test ends —
// against the suite's global fetch guard it rejects into teardown, which vitest
// reports as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog"
// was pending` and fails the whole run even though every test passed. Stub it:
// this file is about the prefill ordering contract, not about EDHREC.
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
  fetchPartnerCommanderData: () => Promise.resolve(null),
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

import { fillFormatSettings } from '@/lib/coach/fill-deck';
import { DeckGeneratePage } from './DeckGeneratePage';
import { defaultCustomization, useDeckBuilderStore } from '@/deck-builder/store';

function renderFormat(format: string) {
  return render(
    <MemoryRouter initialEntries={[`/decks/new/generate?format=${format}`]}>
      <DeckGeneratePage />
    </MemoryRouter>
  );
}

const cz = () => useDeckBuilderStore.getState().customization;

describe('DeckGeneratePage format settings', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
  });

  it('builds Brawl as a 60-card brawl deck with its own land count', () => {
    renderFormat('brawl');
    expect(cz().mtgFormat).toBe('brawl');
    expect(cz().deckFormat).toBe(60);
    expect(cz().landCount).toBe(23);
    expect(cz().nonBasicLandCount).toBe(9);
    // The EDHREC 100-card land pre-fill must not overwrite it.
    expect(useDeckBuilderStore.getState().userEditedLands).toBe(true);
  });

  it.each([
    ['commander', 'commander'],
    ['paupercommander', 'paupercommander'],
  ])('keeps %s on the 99-card defaults', (format, mtgFormat) => {
    renderFormat(format);
    expect(cz().mtgFormat).toBe(mtgFormat);
    expect(cz().deckFormat).toBe(defaultCustomization.deckFormat);
    expect(cz().landCount).toBe(defaultCustomization.landCount);
    expect(cz().nonBasicLandCount).toBe(defaultCustomization.nonBasicLandCount);
  });

  it('stamps the 99-card formats with mtgFormat alone, as the page always did', () => {
    expect(fillFormatSettings('commander')).toEqual({ mtgFormat: 'commander' });
    expect(fillFormatSettings('paupercommander')).toEqual({ mtgFormat: 'paupercommander' });
  });

  it('does not leak a Brawl visit into the next Commander page', () => {
    const brawl = renderFormat('brawl');
    brawl.unmount();
    renderFormat('commander');
    expect(cz().mtgFormat).toBe('commander');
    expect(cz().deckFormat).toBe(defaultCustomization.deckFormat);
    expect(cz().landCount).toBe(defaultCustomization.landCount);
    expect(useDeckBuilderStore.getState().userEditedLands).toBe(false);
  });
});

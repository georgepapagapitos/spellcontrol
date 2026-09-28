// @vitest-environment happy-dom
/**
 * The start page (/decks/new): format first, then one door per way to start.
 * Which doors show depends on the format, the picked format rides along in
 * `?format=`, the "Empty deck" door (E465) still creates a Private deck in one
 * tap, and generation intent that lands here from before the split is
 * forwarded to the generator intact.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});
const createDeckMock = vi.fn((_input: Record<string, unknown>) => 'empty-deck-id');
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: typeof createDeckMock }) => unknown) =>
    sel({ decks: [], createDeck: createDeckMock }),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({
  ImportDeckDialog: ({ format }: { format: string }) => <div>import dialog for {format}</div>,
}));
vi.mock('../components/ProductSearchDialog', () => ({
  ProductSearchDialog: () => <div>product dialog</div>,
}));

import { DeckNewPage } from './DeckNewPage';

/** Stands in for the generator: shows where the door sent us and what rode along. */
function GenerateProbe() {
  const { search, state } = useLocation();
  const s = state as { prefill?: { commander?: { name: string } }; commanderSource?: string };
  return (
    <p>
      generator {search} {s?.prefill?.commander?.name ?? ''} {s?.commanderSource ?? ''}
    </p>
  );
}

function renderAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/decks/new" element={<DeckNewPage />} />
        <Route path="/decks/new/generate" element={<GenerateProbe />} />
        <Route path="/decks/new/brew" element={<p>brew mode</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const door = (name: string | RegExp) =>
  screen.queryByRole('link', { name }) ?? screen.queryByRole('button', { name });

beforeEach(() => localStorage.clear());
afterEach(() => {
  navigateMock.mockClear();
  createDeckMock.mockClear();
});

describe('DeckNewPage — doors', () => {
  it('offers every start for Commander, Generate first', () => {
    renderAt('/decks/new');
    const names = [
      'Generate a deck',
      'Brew it slot by slot',
      'Empty deck',
      'Import a list',
      'Add a product',
    ];
    const els = names.map((n) => door(n));
    els.forEach((el, i) => expect(el, names[i]).toBeTruthy());
    for (let i = 1; i < els.length; i++) {
      expect(
        els[i - 1]!.compareDocumentPosition(els[i]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it('names each door by its title and describes it separately', () => {
    renderAt('/decks/new');
    const brew = door('Brew it slot by slot')!;
    expect(brew.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('sends Generate to the generator with the format, and Brew to brew mode', () => {
    renderAt('/decks/new');
    fireEvent.click(door('Generate a deck')!);
    expect(screen.getByText(/generator \?format=commander/)).toBeTruthy();
  });

  it('opens brew mode from its door', () => {
    renderAt('/decks/new');
    fireEvent.click(door('Brew it slot by slot')!);
    expect(screen.getByText('brew mode')).toBeTruthy();
  });

  it('drops Brew for Pauper Commander, which EDHREC has no data for, but keeps Generate', () => {
    renderAt('/decks/new?format=paupercommander');
    expect(door('Brew it slot by slot')).toBeNull();
    fireEvent.click(door('Generate a deck')!);
    expect(screen.getByText(/generator \?format=paupercommander/)).toBeTruthy();
  });

  it('offers a product only under Commander, whose precons it builds', () => {
    renderAt('/decks/new?format=brawl');
    expect(door('Add a product')).toBeNull();
  });

  it('shows only the empty and import starts for a format without a commander, and says why', () => {
    renderAt('/decks/new?format=modern');
    expect(door('Generate a deck')).toBeNull();
    expect(door('Brew it slot by slot')).toBeNull();
    expect(door('Add a product')).toBeNull();
    expect(door('Empty Modern deck')).toBeTruthy();
    expect(door('Import a list')).toBeTruthy();
    expect(screen.getByText('Generating and brewing need a commander format.')).toBeTruthy();
  });

  it('writes a picked format into the address, so Back and reload keep it', () => {
    renderAt('/decks/new');
    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect((screen.getByRole('radio', { name: 'Standard' }) as HTMLInputElement).checked).toBe(
      true
    );
    expect(door('Empty Standard deck')).toBeTruthy();
  });

  it('ignores a format it does not know', () => {
    renderAt('/decks/new?format=not-a-format');
    expect((screen.getByRole('radio', { name: 'Commander' }) as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('opens the import dialog in the picked format', () => {
    renderAt('/decks/new?format=pioneer');
    fireEvent.click(door('Import a list')!);
    expect(screen.getByText('import dialog for pioneer')).toBeTruthy();
  });

  it('opens the product dialog', () => {
    renderAt('/decks/new');
    fireEvent.click(door('Add a product')!);
    expect(screen.getByText('product dialog')).toBeTruthy();
  });
});

describe('DeckNewPage — Empty deck door', () => {
  it('creates a Private deck with no commander and opens it', () => {
    renderAt('/decks/new');
    fireEvent.click(door('Empty deck')!);
    expect(createDeckMock).toHaveBeenCalledTimes(1);
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'manual',
        format: 'commander',
        commander: null,
        partnerCommander: null,
        initialVisibility: 'private',
      })
    );
    // The store default names it; the door never invents a name.
    expect(createDeckMock.mock.calls[0][0]).not.toHaveProperty('name');
    expect(navigateMock).toHaveBeenCalledWith('/decks/empty-deck-id');
  });

  it('uses the selected format', () => {
    renderAt('/decks/new?format=brawl');
    fireEvent.click(door('Empty deck')!);
    expect(createDeckMock).toHaveBeenCalledWith(expect.objectContaining({ format: 'brawl' }));
  });

  it('creates a 60-card format deck Private too', () => {
    renderAt('/decks/new?format=modern');
    fireEvent.click(door('Empty Modern deck')!);
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'modern', initialVisibility: 'private' })
    );
  });
});

describe('DeckNewPage — generation intent from before the split', () => {
  it('forwards a regenerate or combo prefill to the generator, in its format', () => {
    renderAt({
      pathname: '/decks/new',
      state: {
        prefill: { commander: { name: 'Kess, Dissident Mage' }, format: 'paupercommander' },
      },
    });
    expect(
      screen.getByText(/generator \?format=paupercommander Kess, Dissident Mage/)
    ).toBeTruthy();
  });

  it('forwards the collection door', () => {
    renderAt({ pathname: '/decks/new', state: { commanderSource: 'binder' } });
    expect(screen.getByText(/generator \?format=commander\s+binder/)).toBeTruthy();
  });
});

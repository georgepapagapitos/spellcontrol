// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadResponse } from '../types';

// --- Module mocks (declared before lazy imports) ---

const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
  useSetMap: () => new Map(),
}));

const loadSampleBindersMock = vi.fn<(r: UploadResponse | null) => Promise<string[]>>();
const setErrorMock = vi.fn<(e: string | null) => void>();

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => {
    const fakeStore = {
      loadSampleBinders: loadSampleBindersMock,
      setError: setErrorMock,
    };
    return sel(fakeStore);
  },
}));

// Capture navigate calls for assertions
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...real,
    useNavigate: () => navigateMock,
  };
});

import { WelcomePage } from './WelcomePage';
import { hasEverVisited, markEverVisited } from '../lib/first-run';

// ---

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <WelcomePage />
    </MemoryRouter>
  );
}

const STUB_RESPONSE: UploadResponse = {
  cards: [],
  totalRows: 0,
  unresolvedNames: [],
  fetchErrors: [],
  detectedFormat: 'csv',
  scryfallHits: 0,
  scryfallMisses: 0,
};

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockReset();
  importTextMock.mockReset();
  loadSampleBindersMock.mockReset();
  setErrorMock.mockReset();
  importTextMock.mockResolvedValue(STUB_RESPONSE);
  loadSampleBindersMock.mockResolvedValue([]);
});

// ============================================================
// Render
// ============================================================

describe('WelcomePage renders', () => {
  it('shows brand name, tagline, and all three doors', () => {
    renderWelcome();
    expect(screen.getByText('SpellControl')).toBeTruthy();
    expect(screen.getByRole('button', { name: /import my collection/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /try sample cards/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });
});

// ============================================================
// Door 1 — Import my collection
// ============================================================

describe('Door 1 — Import my collection', () => {
  it('marks ever-visited and navigates to /collection?add=list', () => {
    renderWelcome();
    expect(hasEverVisited()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /import my collection/i }));
    expect(hasEverVisited()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith('/collection?add=list');
  });

  it('does not call importText or loadSampleBinders', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /import my collection/i }));
    expect(importTextMock).not.toHaveBeenCalled();
    expect(loadSampleBindersMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// Door 2 — Try sample cards
// ============================================================

describe('Door 2 — Try sample cards', () => {
  it('calls importText then loadSampleBinders, marks visited, navigates to /collection', async () => {
    renderWelcome();
    expect(hasEverVisited()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    await waitFor(() => {
      expect(importTextMock).toHaveBeenCalledTimes(1);
      expect(loadSampleBindersMock).toHaveBeenCalledWith(STUB_RESPONSE);
    });

    expect(hasEverVisited()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith('/collection');
  });

  it('shows loading state while samples are being loaded', async () => {
    // Make the mock hang until we resolve it manually
    let resolve!: (v: UploadResponse) => void;
    importTextMock.mockReturnValue(new Promise<UploadResponse>((r) => (resolve = r)));

    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    // During load: the samples button shows progress. The other two doors
    // navigate to independent routes, so they must stay enabled (UX-331:
    // disabled-scope matches the interaction, not the page).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loading samples/i })).toBeTruthy();
    });
    expect(
      screen.getByRole('button', { name: /import my collection/i }).hasAttribute('disabled')
    ).toBe(false);
    expect(screen.getByRole('button', { name: /sign in/i }).hasAttribute('disabled')).toBe(false);

    // Clean up
    resolve(STUB_RESPONSE);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it('shows an error message and does NOT mark visited when sample load fails', async () => {
    importTextMock.mockRejectedValue(new Error('Network error'));

    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeTruthy();
    });

    expect(hasEverVisited()).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// Door 3 — Sign in
// ============================================================

describe('Door 3 — Sign in', () => {
  it('navigates to /auth WITHOUT marking ever-visited', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(navigateMock).toHaveBeenCalledWith('/auth');
    // Not marked — dismissal happens when the user completes an auth action
    expect(hasEverVisited()).toBe(false);
  });
});

// ============================================================
// No-reshow: gate stays dismissed after the welcome is seen
// ============================================================

describe('Dismissal persistence — no reshow', () => {
  it('hasEverVisited stays true after Door 1 closes the welcome', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /import my collection/i }));
    // Simulate a page reload by clearing module state and re-reading localStorage
    expect(hasEverVisited()).toBe(true);
  });

  it('hasEverVisited stays true after Door 2 closes the welcome', async () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /try sample cards/i }));
    await waitFor(() => expect(hasEverVisited()).toBe(true));
  });

  it('hasEverVisited is still false after Door 3 (auth not yet completed)', () => {
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(hasEverVisited()).toBe(false);
  });

  it('markEverVisited persists across a simulated remount check', () => {
    markEverVisited();
    // Simulate the gate check a second app boot would do:
    expect(hasEverVisited()).toBe(true);
    // And the localStorage key is set:
    expect(localStorage.getItem('sc-ever-visited-app')).toBe('1');
  });
});

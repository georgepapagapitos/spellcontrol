// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth-api', () => ({
  fetchProviders: vi.fn(() => Promise.resolve({ google: false })),
  googleSignInUrl: vi.fn(() => 'https://example.test/oauth'),
}));
vi.mock('../lib/platform', () => ({ isNativePlatform: () => false }));
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: unknown[] }) => unknown) => selector({ cards: [] }),
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      error: null,
      status: 'guest',
      clearError: vi.fn(),
      login: vi.fn(() => Promise.resolve(true)),
      register: vi.fn(() => Promise.resolve(true)),
    }),
}));
vi.mock('../store/toasts', () => ({ toast: { show: vi.fn() } }));

const markEverVisited = vi.fn();
vi.mock('../lib/first-run', () => ({ markEverVisited: () => markEverVisited() }));

const mockNavigate = vi.fn();
let search = '';
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(search), vi.fn()],
  };
});

import AuthPage from './AuthPage';

function renderPage(query: string) {
  search = query;
  mockNavigate.mockClear();
  markEverVisited.mockClear();
  return render(
    <MemoryRouter initialEntries={['/auth' + (query ? `?${query}` : '')]}>
      <AuthPage />
    </MemoryRouter>
  );
}

describe('AuthPage — "Continue without an account"', () => {
  it('returns to the page the guest gate was on', () => {
    renderPage('returnTo=%2Ffriends');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
    expect(markEverVisited).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/friends', { replace: true });
  });

  it('lands on the default when there is nothing to return to', () => {
    renderPage('');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('never follows an off-site returnTo', () => {
    renderPage('returnTo=%2F%2Fevil.example');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});

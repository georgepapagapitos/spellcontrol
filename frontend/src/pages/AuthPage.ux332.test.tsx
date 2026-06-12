// @vitest-environment happy-dom
/**
 * UX-332 — Data-semantics honesty: guest data promotion copy.
 *
 * Verifies that AuthPage shows a plain-language sentence about local card
 * promotion when there are cards on the device, and hides it when there are
 * none. Also verifies the merge toast fires on successful sign-in when
 * local cards are present.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../lib/auth-api', () => ({
  fetchProviders: vi.fn(() => Promise.resolve({ google: false })),
  googleSignInUrl: vi.fn(() => 'https://example.test/oauth'),
}));
vi.mock('../lib/platform', () => ({
  isNativePlatform: () => false,
}));

// Mock the collection store to control the local card count.
const mockCardsLength = { value: 0 };
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: unknown[] }) => unknown) =>
    selector({ cards: Array.from({ length: mockCardsLength.value }) }),
}));

// Mock the auth store for sign-in success.
const mockLogin = vi.fn(() => Promise.resolve(true));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      error: null,
      status: 'guest',
      clearError: vi.fn(),
      login: mockLogin,
      register: vi.fn(() => Promise.resolve(true)),
    }),
}));

// Capture toast calls.
const toastShow = vi.fn();
vi.mock('../store/toasts', () => ({
  toast: { show: (...args: unknown[]) => toastShow(...args) },
}));

vi.mock('../lib/first-run', () => ({ markEverVisited: vi.fn() }));

// react-router navigate mock.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

import AuthPage from './AuthPage';

async function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={['/auth']}>
      <AuthPage />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
  return utils;
}

describe('UX-332 — auth page data-promotion honesty', () => {
  beforeEach(() => {
    mockCardsLength.value = 0;
    mockNavigate.mockReset();
    toastShow.mockReset();
  });

  it('hides the merge notice when there are no local cards', async () => {
    mockCardsLength.value = 0;
    await renderPage();
    expect(screen.queryByText(/will be added to your account/i)).toBeNull();
  });

  it('shows the merge notice with a live count when there are local cards', async () => {
    mockCardsLength.value = 42;
    await renderPage();
    const notice = screen.getByText(/42 cards on this device will be added to your account/i);
    expect(notice).toBeTruthy();
  });

  it('uses singular "card" when the count is 1', async () => {
    mockCardsLength.value = 1;
    await renderPage();
    const notice = screen.getByText(/1 card on this device will be added to your account/i);
    expect(notice).toBeTruthy();
  });

  it('fires a merge toast after successful sign-in when local cards exist', async () => {
    mockCardsLength.value = 7;
    const { container } = await renderPage();

    const usernameInput = container.querySelector('input[autocomplete="username"]');
    const passwordInput = container.querySelector('input[autocomplete="current-password"]');
    if (!usernameInput || !passwordInput) throw new Error('Could not find form inputs');

    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'success',
        message: expect.stringMatching(/7 cards added to your account/i),
      })
    );
  });

  it('does not fire a merge toast when there are no local cards', async () => {
    mockCardsLength.value = 0;
    const { container } = await renderPage();

    const usernameInput = container.querySelector('input[autocomplete="username"]');
    const passwordInput = container.querySelector('input[autocomplete="current-password"]');
    if (!usernameInput || !passwordInput) throw new Error('Could not find form inputs');

    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(toastShow).not.toHaveBeenCalled();
  });
});

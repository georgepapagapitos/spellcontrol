// @vitest-environment happy-dom
/**
 * Regressions around AuthPage's register-failure form state:
 *
 * 1. A rejected register attempt (username taken, a server-side rule, rate
 *    limit, …) must not wipe the confirm-password field. The client-side
 *    "Passwords do not match" guard already returns early before the
 *    backend is ever called, so by the time `register()` resolves false
 *    here, confirm === password is guaranteed — clearing confirm on
 *    failure was never protecting against a real mismatch, just making the
 *    user retype a value that was already correct.
 * 2. A stale backend error (e.g. a prior "username is already taken") must
 *    not keep showing once the *current* submit is blocked by the local
 *    confirm-mismatch check instead — that used to leave an actively wrong
 *    reason on screen with no indication the real problem had changed.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth-api', () => ({
  fetchProviders: vi.fn(() => Promise.resolve({ google: false })),
  googleSignInUrl: vi.fn(() => 'https://example.test/oauth'),
}));
vi.mock('../lib/platform', () => ({
  isNativePlatform: () => false,
}));
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: unknown[] }) => unknown) => selector({ cards: [] }),
}));
// A mutable, selector-read-live object (not a real Zustand store, but close
// enough): `clearError`/`register` mutate `error` in place, and the next
// render (any local setState in AuthPage triggers one) picks up the new
// value — same observable effect as the real store notifying subscribers.
const mockAuthState = {
  error: null as string | null,
  status: 'guest',
  clearError: vi.fn(() => {
    mockAuthState.error = null;
  }),
  login: vi.fn(),
  // Mirrors the real store's register(): resolves false and sets `error`,
  // same as a genuine 409 "username taken" response would.
  register: vi.fn(() => {
    mockAuthState.error = 'That username is already taken.';
    return Promise.resolve(false);
  }),
};
const mockRegister = mockAuthState.register;
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));
vi.mock('../store/toasts', () => ({ toast: { show: vi.fn() } }));
vi.mock('../lib/first-run', () => ({ markEverVisited: vi.fn() }));

import AuthPage from './AuthPage';

async function renderRegisterMode() {
  const utils = render(
    <MemoryRouter initialEntries={['/auth']}>
      <AuthPage />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
  return utils;
}

describe('AuthPage register-failure form state', () => {
  beforeEach(() => {
    mockRegister.mockClear();
    mockAuthState.clearError.mockClear();
    mockAuthState.error = null;
  });

  it('keeps the confirm-password value after a rejected register', async () => {
    const { container } = await renderRegisterMode();

    const usernameInput = container.querySelector('input[autocomplete="username"]');
    const passwordInput = container.querySelector('input[autocomplete="new-password"]');
    const confirmInput = container.querySelectorAll('input[type="password"]')[1];
    if (!usernameInput || !passwordInput || !confirmInput) {
      throw new Error('Could not find form inputs');
    }
    fireEvent.change(usernameInput, { target: { value: 'dev' } });
    fireEvent.change(passwordInput, { target: { value: 'matchingpassword1' } });
    fireEvent.change(confirmInput, { target: { value: 'matchingpassword1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    expect((confirmInput as HTMLInputElement).value).toBe('matchingpassword1');
  });

  it('replaces a stale backend error with the confirm-mismatch reason instead of stacking/hiding it', async () => {
    const { container } = await renderRegisterMode();

    const usernameInput = container.querySelector('input[autocomplete="username"]');
    const passwordInput = container.querySelector('input[autocomplete="new-password"]');
    const confirmInput = container.querySelectorAll('input[type="password"]')[1];
    if (!usernameInput || !passwordInput || !confirmInput) {
      throw new Error('Could not find form inputs');
    }

    // First attempt: matching passwords, but the backend rejects the
    // username — a real "That username is already taken." error banner.
    fireEvent.change(usernameInput, { target: { value: 'dev' } });
    fireEvent.change(passwordInput, { target: { value: 'onepassword1' } });
    fireEvent.change(confirmInput, { target: { value: 'onepassword1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('That username is already taken.')
    );

    // Second attempt: edit confirm into a mismatch and resubmit — blocked by
    // the local guard before the backend is ever called again.
    fireEvent.change(confirmInput, { target: { value: 'differentpassword2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(mockRegister).toHaveBeenCalledTimes(1); // not called again
    // The banner now shows the real, current reason instead of the stale
    // one — never both, never neither.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe('Passwords do not match.');
  });
});

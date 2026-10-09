// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { authState, mockResetPasswordWithToken } = vi.hoisted(() => ({
  authState: {
    status: 'guest' as 'guest' | 'authed',
    error: null as string | null,
    clearError: vi.fn(),
  },
  mockResetPasswordWithToken: vi.fn(),
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ ...authState, resetPasswordWithToken: mockResetPasswordWithToken }),
}));
vi.mock('../store/toasts', () => ({ toast: { show: vi.fn() } }));

import ResetPasswordPage from './ResetPasswordPage';

function renderPage(path = '/reset-password?token=abc123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ResetPasswordPage />
    </MemoryRouter>
  );
}

// The password/confirm fields both carry autocomplete="new-password" and
// wrap a trailing <ul> of live requirement copy inside their <label>, so
// getByLabelText's aggregated-text match doesn't isolate either one — same
// reason AuthPage's own tests select by input, not label (see
// AuthPage.register-failure.test.tsx).
function passwordInputs(container: HTMLElement): [HTMLInputElement, HTMLInputElement] {
  const [password, confirm] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="password"]')
  );
  return [password, confirm];
}

beforeEach(() => {
  authState.status = 'guest';
  authState.error = null;
  mockResetPasswordWithToken.mockReset();
});

describe('ResetPasswordPage', () => {
  it('shows an invalid-link state and no form when the URL has no token', () => {
    const { container } = renderPage('/reset-password');
    expect(screen.getByText("That link isn't valid")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('submits the new password with the token from the URL', async () => {
    mockResetPasswordWithToken.mockResolvedValue(true);
    const { container } = renderPage();
    const [password, confirm] = passwordInputs(container);
    fireEvent.change(password, { target: { value: 'a brand new password' } });
    fireEvent.change(confirm, { target: { value: 'a brand new password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() =>
      expect(mockResetPasswordWithToken).toHaveBeenCalledWith('abc123', 'a brand new password')
    );
  });

  it('blocks submit locally, without calling the store, when the passwords differ', () => {
    const { container } = renderPage();
    const [password, confirm] = passwordInputs(container);
    fireEvent.change(password, { target: { value: 'a brand new password' } });
    fireEvent.change(confirm, { target: { value: 'something else entirely' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(mockResetPasswordWithToken).not.toHaveBeenCalled();
  });

  it('shows the store error and offers a "request a new link" escape hatch', () => {
    authState.error = 'That reset link has expired or was already used. Request a new one.';
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/expired/);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeTruthy();
  });
});

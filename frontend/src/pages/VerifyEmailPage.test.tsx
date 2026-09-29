// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockVerifyEmail, mockResend, authState } = vi.hoisted(() => ({
  mockVerifyEmail: vi.fn(),
  mockResend: vi.fn(),
  authState: { username: null as string | null },
}));
vi.mock('@/lib/account/auth-api', () => ({
  verifyEmail: mockVerifyEmail,
  resendEmailVerification: mockResend,
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: authState.username ? { username: authState.username } : null }),
}));

import VerifyEmailPage from './VerifyEmailPage';

function renderPage(path = '/verify-email?token=abc123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmailPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockVerifyEmail.mockReset();
  mockResend.mockReset();
  authState.username = null;
});

describe('VerifyEmailPage', () => {
  it('shows "nothing to verify" when the URL has no token', () => {
    renderPage('/verify-email');
    expect(screen.getByText("There's nothing to verify here")).toBeTruthy();
    expect(mockVerifyEmail).not.toHaveBeenCalled();
  });

  it('verifies the token and shows the success state', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByText('Email verified')).toBeTruthy();
    expect(mockVerifyEmail).toHaveBeenCalledWith('abc123');
  });

  it('shows the error state with a sign-in prompt when signed out', async () => {
    mockVerifyEmail.mockRejectedValue(
      new Error('That verification link has expired or was already used.')
    );
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    expect(screen.getByText(/Sign in, then request a new verification email/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
  });

  it('offers a resend button when signed in, and confirms once sent', async () => {
    authState.username = 'alice';
    mockVerifyEmail.mockRejectedValue(new Error('Expired.'));
    mockResend.mockResolvedValue(undefined);
    renderPage();

    const resendButton = await screen.findByRole('button', { name: 'Send a new link' });
    fireEvent.click(resendButton);

    await waitFor(() => expect(mockResend).toHaveBeenCalled());
    expect(await screen.findByText(/We've sent a new link/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
  });
});

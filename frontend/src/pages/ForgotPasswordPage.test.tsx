// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockForgotPassword } = vi.hoisted(() => ({ mockForgotPassword: vi.fn() }));
vi.mock('@/lib/account/auth-api', () => ({ forgotPassword: mockForgotPassword }));

import ForgotPasswordPage from './ForgotPasswordPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockForgotPassword.mockReset();
});

describe('ForgotPasswordPage', () => {
  it('sends the trimmed email and shows the same confirmation copy on success', async () => {
    mockForgotPassword.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  alice@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledWith('alice@example.com'));
    expect(screen.getByText(/If an account uses that email, we've sent a link/)).toBeTruthy();
    // The form is gone — nothing left to distinguish "account exists" from not.
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('shows an error and keeps the form when the request itself fails', async () => {
    mockForgotPassword.mockRejectedValue(new Error("Couldn't send that. Try again."));
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bob@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Try again/);
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('links back to sign in', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });
});

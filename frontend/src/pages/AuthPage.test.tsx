// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth-api', () => ({
  fetchProviders: vi.fn(() => Promise.resolve({ google: false })),
  googleSignInUrl: vi.fn(() => 'https://example.test/oauth'),
}));
vi.mock('../lib/platform', () => ({
  isNativePlatform: () => false,
}));

import AuthPage from './AuthPage';

async function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={['/auth']}>
      <AuthPage />
    </MemoryRouter>
  );
  // Let the providers-discovery effect settle inside act.
  await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
  return utils;
}

describe('AuthPage tabs', () => {
  it('renders the mode switcher through the shared Tabs primitive', async () => {
    const { container } = await renderPage();
    const tablist = screen.getByRole('tablist', { name: 'Sign in or create account' });
    expect(tablist.classList.contains('sc-tabs')).toBe(true);
    // Positioning hook stays on the shared strip; the hand-rolled buttons are gone.
    expect(tablist.classList.contains('auth-tabs')).toBe(true);
    expect(container.querySelector('.auth-tab')).toBeNull();
  });

  it('defaults to Sign in with roving tabindex', async () => {
    await renderPage();
    const signIn = screen.getByRole('tab', { name: 'Sign in' });
    expect(signIn.getAttribute('aria-selected')).toBe('true');
    expect(signIn.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Create account' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Confirm password')).toBeNull();
  });

  it('switches to register mode on tab click', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByRole('tab', { name: 'Create account' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByText('Confirm password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });
});

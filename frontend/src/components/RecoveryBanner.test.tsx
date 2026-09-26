// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';

import { RecoveryBanner } from './RecoveryBanner';

function renderBanner() {
  return render(
    <MemoryRouter>
      <RecoveryBanner />
    </MemoryRouter>
  );
}

type AuthPatch = Partial<ReturnType<typeof useAuth.getState>>;

function setAuth(patch: AuthPatch) {
  useAuth.setState({
    user: { id: 'u1', username: 'pat', role: 'user' },
    status: 'authed',
    emailVerified: true,
    error: null,
    ...patch,
  });
}

describe('RecoveryBanner', () => {
  it('stays hidden for an account that can receive a reset', () => {
    setAuth({ emailVerified: true });
    const { container } = renderBanner();
    expect(container.querySelector('.recovery-banner')).toBeFalsy();
  });

  it('shows for a signed-in account with no confirmed address', () => {
    setAuth({ emailVerified: false });
    renderBanner();
    expect(screen.getByText('Confirm your email.')).toBeTruthy();
  });

  it('has no dismiss — the only way out is confirming the address', () => {
    setAuth({ emailVerified: false });
    renderBanner();
    const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')];
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toBe('Confirm email');
  });

  it('sends the person to the sign-in methods card, where the address lives', () => {
    setAuth({ emailVerified: false });
    renderBanner();
    expect(screen.getByRole('link', { name: 'Confirm email' }).getAttribute('href')).toBe(
      '/you?section=sign-in'
    );
  });

  it('stays hidden while signed out, where it could not be acted on', () => {
    setAuth({ status: 'guest', user: null, emailVerified: false });
    const { container } = renderBanner();
    expect(container.querySelector('.recovery-banner')).toBeFalsy();
  });
});

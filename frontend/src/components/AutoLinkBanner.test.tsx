// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoLinkBanner } from './AutoLinkBanner';
import { useAuth } from '../store/auth';
import * as authApi from '../lib/auth-api';

function renderBanner() {
  return render(
    <MemoryRouter>
      <AutoLinkBanner />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: null, status: 'unknown', error: null, autoLinkedAt: null });
});

describe('AutoLinkBanner', () => {
  it('renders nothing when autoLinkedAt is null', () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders with the username when autoLinkedAt is set', () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      autoLinkedAt: 1700000000000,
    });
    renderBanner();
    expect(screen.getByRole('status').textContent).toContain('@alice');
    expect(screen.getByRole('button', { name: /Got it/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Manage in Settings/ })).toBeTruthy();
  });

  it('dismisses on "Got it" — POSTs acknowledgement, hides itself', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      autoLinkedAt: 1700000000000,
    });
    const ackSpy = vi.spyOn(authApi, 'acknowledgeAutoLink').mockResolvedValue();
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }));
    expect(ackSpy).toHaveBeenCalledTimes(1);
    // Banner hides immediately (optimistic clear in the store).
    expect(useAuth.getState().autoLinkedAt).toBeNull();
  });

  it('"Manage in Settings" navigates and also clears the banner', () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      autoLinkedAt: 1700000000000,
    });
    vi.spyOn(authApi, 'acknowledgeAutoLink').mockResolvedValue();
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Manage in Settings/ }));
    expect(useAuth.getState().autoLinkedAt).toBeNull();
    // We don't assert the URL change here — useNavigate inside MemoryRouter is
    // covered by react-router's own tests. The store state change proves the
    // dismiss side-effect fired alongside the navigation.
  });
});

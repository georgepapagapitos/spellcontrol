// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';

const { fetchMock, setMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), setMock: vi.fn() }));
vi.mock('../lib/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth-api')>()),
  fetchCollectionVisibility: () => fetchMock(),
  setCollectionVisibility: (v: string) => setMock(v),
}));

import { CollectionVisibilityDialog } from './CollectionVisibilityDialog';

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;

function renderDialog(onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <CollectionVisibilityDialog onClose={() => {}} onChanged={onChanged} />
    </MemoryRouter>
  );
  return onChanged;
}

beforeEach(() => {
  fetchMock.mockReset();
  setMock.mockReset();
  setMock.mockImplementation((v: string) => Promise.resolve(v));
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
});

describe('CollectionVisibilityDialog', () => {
  it('opens on the saved choice and shows where it lives', async () => {
    fetchMock.mockResolvedValue('public');
    renderDialog();
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    expect(screen.getByText(/with quantities and prices/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement).value).toMatch(
      /\/u\/alice\?tab=collection$/
    );
    expect(setMock).not.toHaveBeenCalled();
  });

  it('an account that never chose sees nothing picked, and what friends see today', async () => {
    fetchMock.mockResolvedValue(null);
    renderDialog();
    await screen.findByRole('radio', { name: 'Private' });
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByText(/not how many or what they're worth/)).toBeTruthy();
  });

  it('applies a pick at once and says so to the page', async () => {
    fetchMock.mockResolvedValue('public');
    const onChanged = renderDialog();
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    fireEvent.click(radio('Private'));
    await waitFor(() => expect(radio('Private').checked).toBe(true));
    expect(setMock).toHaveBeenCalledWith('private');
    expect(onChanged).toHaveBeenCalledWith('private');
    // Private has no address to hand out.
    expect(screen.queryByRole('textbox', { name: 'Link' })).toBeNull();
  });

  it('a failed change says so and keeps the previous choice', async () => {
    fetchMock.mockResolvedValue('friends');
    setMock.mockRejectedValue(new Error('offline'));
    renderDialog();
    await waitFor(() => expect(radio('Friends').checked).toBe(true));
    fireEvent.click(radio('Public'));
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    expect(radio('Friends').checked).toBe(true);
  });

  it('asks a guest to sign in', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderDialog();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

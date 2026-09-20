// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../store/auth';
import { UsernameChangeError } from '../lib/auth-api';
import { useToastsStore } from '../store/toasts';

const changeUsernameMock = vi.fn<(username: string) => Promise<unknown>>();
vi.mock('../lib/auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth-api')>();
  return { ...actual, changeUsername: (u: string) => changeUsernameMock(u) };
});

import { UsernameEditor } from './UsernameEditor';

const toastMessages = () => useToastsStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  changeUsernameMock.mockReset();
  useAuth.setState({
    user: { id: 'u1', username: 'oldname', role: 'user' },
    status: 'authed',
    error: null,
  });
});

function typeUsername(value: string) {
  fireEvent.change(screen.getByLabelText('New username'), { target: { value } });
}

describe('UsernameEditor', () => {
  it('shows the current handle and keeps the button off until the draft is a real change', () => {
    render(<UsernameEditor />);
    expect(screen.getByText('@oldname')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Change username' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // Same handle in different case is not a change.
    typeUsername('OldName');
    expect(button.disabled).toBe(true);

    typeUsername('newname');
    expect(button.disabled).toBe(false);
  });

  it('refuses a malformed handle in the UI, with the rule spelled out', () => {
    render(<UsernameEditor />);
    typeUsername('no');

    expect(
      (screen.getByRole('button', { name: 'Change username' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      screen.getByText('3 to 32 characters, using lowercase letters, digits, _ and -.')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('New username') as HTMLInputElement).getAttribute('aria-invalid')
    ).toBe('true');
  });

  it('confirms before changing, and cancel calls nothing', async () => {
    render(<UsernameEditor />);
    typeUsername('newname');
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));

    await screen.findByText('Change to @newname?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Change to @newname?')).toBeNull());
    expect(changeUsernameMock).not.toHaveBeenCalled();
  });

  it('confirming renames the account and updates the signed-in identity', async () => {
    changeUsernameMock.mockResolvedValueOnce({ id: 'u1', username: 'newname', role: 'user' });
    render(<UsernameEditor />);
    typeUsername('newname');
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await screen.findByText('Change to @newname?');
    fireEvent.click(screen.getByRole('button', { name: 'Change to @newname' }));

    await waitFor(() => expect(changeUsernameMock).toHaveBeenCalledWith('newname'));
    await waitFor(() => expect(useAuth.getState().user?.username).toBe('newname'));
    expect(toastMessages()).toContain('You are now @newname');
    // The current-handle line follows the store, so the section is correct
    // without a reload.
    expect(screen.getByText('@newname')).toBeTruthy();
  });

  it('turns a cooldown refusal into a date the person can act on', async () => {
    const nextChangeAt = Date.parse('2026-12-25T00:00:00Z');
    changeUsernameMock.mockRejectedValueOnce(
      new UsernameChangeError('You can change your username once every 30 days.', 429, {
        nextChangeAt,
      })
    );
    render(<UsernameEditor />);
    typeUsername('newname');
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await screen.findByText('Change to @newname?');
    fireEvent.click(screen.getByRole('button', { name: 'Change to @newname' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('You can change your username once every 30 days.');
    expect(alert.textContent).toContain('Try again from');
    // The dialog closes so the message is not hidden behind it.
    expect(screen.queryByText('Change to @newname?')).toBeNull();
  });

  it('reports a handle held by someone else without naming them', async () => {
    changeUsernameMock.mockRejectedValueOnce(
      new UsernameChangeError('That username is not available yet.', 409, {
        availableAt: Date.parse('2026-11-01T00:00:00Z'),
      })
    );
    render(<UsernameEditor />);
    typeUsername('wanted');
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await screen.findByText('Change to @wanted?');
    fireEvent.click(screen.getByRole('button', { name: 'Change to @wanted' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('That username is not available yet.');
    expect(useAuth.getState().user?.username).toBe('oldname');
  });

  it('falls back to a plain message when the failure carries no date', async () => {
    changeUsernameMock.mockRejectedValueOnce(
      new UsernameChangeError('That username is already taken.', 409, {})
    );
    render(<UsernameEditor />);
    typeUsername('occupied');
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await screen.findByText('Change to @occupied?');
    fireEvent.click(screen.getByRole('button', { name: 'Change to @occupied' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That username is already taken.');
  });
});

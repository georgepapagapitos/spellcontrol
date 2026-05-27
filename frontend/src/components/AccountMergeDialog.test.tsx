// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountMergeDialog } from './AccountMergeDialog';
import { invokeCollisionHandler, hasCollisionHandler } from '../lib/sync-collision';

const info = {
  local: { cards: 5000, binders: 3, decks: 2, lists: 0, games: 0 },
  server: { cards: 100, binders: 1, decks: 0, lists: 1, games: 4 },
  accountLabel: 'alice',
};

describe('AccountMergeDialog', () => {
  it('registers a handler while mounted and resolves with the clicked choice', async () => {
    const { unmount } = render(<AccountMergeDialog />);
    expect(hasCollisionHandler()).toBe(true);

    const promise = invokeCollisionHandler(info);

    // Modal renders both side summaries and the three choice buttons.
    await screen.findByText('This account already has data');
    expect(screen.getByText(/Signed in as/i).textContent).toContain('alice');
    expect(screen.getByText('5,000', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('100', { selector: 'strong' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Merge both' }));
    await expect(promise).resolves.toBe('merge');

    unmount();
    expect(hasCollisionHandler()).toBe(false);
  });

  it('resolves with keep-local when that button is clicked', async () => {
    render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler(info);
    await screen.findByText('This account already has data');
    fireEvent.click(screen.getByRole('button', { name: "Keep this device's data" }));
    await expect(promise).resolves.toBe('keep-local');
  });

  it('resolves with keep-server when that button is clicked', async () => {
    render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler(info);
    await screen.findByText('This account already has data');
    fireEvent.click(screen.getByRole('button', { name: 'Use account data' }));
    await expect(promise).resolves.toBe('keep-server');
  });

  it('falls back to keep-server when the modal is dismissed via backdrop', async () => {
    render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler(info);
    await screen.findByText('This account already has data');
    // Click the backdrop (the modal-backdrop wrapper).
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    await expect(promise).resolves.toBe('keep-server');
  });

  it('falls back to keep-server if unmounted with a prompt open', async () => {
    const { unmount } = render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler(info);
    await screen.findByText('This account already has data');
    unmount();
    await expect(promise).resolves.toBe('keep-server');
  });

  it('uses the generic label when no accountLabel is provided', async () => {
    render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler({ ...info, accountLabel: '' });
    await screen.findByText('This account already has data');
    // The body paragraph splits "signed in as <strong>this account</strong>"
    // across text nodes — assert on the visible <strong> instead of the
    // surrounding sentence, since the strong is the substitution point.
    expect(screen.getByText('this account', { selector: 'strong' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use account data' }));
    await waitFor(() => expect(promise).resolves.toBe('keep-server'));
  });
});

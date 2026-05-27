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

  it('is non-dismissable — backdrop clicks do nothing, only buttons resolve', async () => {
    // The merge prompt is the one dialog where an accidental dismissal
    // means permanent data movement; force an explicit button choice.
    render(<AccountMergeDialog />);
    const promise = invokeCollisionHandler(info);
    await screen.findByText('This account already has data');

    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    // Escape also disabled.
    fireEvent.keyDown(document, { key: 'Escape' });

    // Modal still open — promise still pending. Resolve via the actual
    // button to keep the test deterministic.
    const stillOpen = await Promise.race([
      promise,
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 50)),
    ]);
    expect(stillOpen).toBe('pending');

    fireEvent.click(screen.getByRole('button', { name: 'Use account data' }));
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

  describe('empty-server variant (guest → empty account)', () => {
    const emptyServerInfo = {
      local: { cards: 100, binders: 2, decks: 0, lists: 0, games: 0 },
      server: { cards: 0, binders: 0, decks: 0, lists: 0, games: 0 },
      accountLabel: 'dev',
    };

    it('renders the "move your local data" variant when server is empty', async () => {
      render(<AccountMergeDialog />);
      const promise = invokeCollisionHandler(emptyServerInfo);
      await screen.findByText('Move your local data to this account?');
      // Only two choices in this variant — no "Merge both" button.
      expect(screen.getByRole('button', { name: /Move it to this account/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Start fresh/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Merge both' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Move it to this account/i }));
      await expect(promise).resolves.toBe('keep-local');
    });

    it('Start fresh resolves with keep-server (wipes local on the empty account)', async () => {
      render(<AccountMergeDialog />);
      const promise = invokeCollisionHandler(emptyServerInfo);
      await screen.findByText('Move your local data to this account?');
      fireEvent.click(screen.getByRole('button', { name: /Start fresh/i }));
      await expect(promise).resolves.toBe('keep-server');
    });

    it('is non-dismissable too — backdrop clicks on the empty-server variant do nothing', async () => {
      render(<AccountMergeDialog />);
      const promise = invokeCollisionHandler(emptyServerInfo);
      await screen.findByText('Move your local data to this account?');
      const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
      fireEvent.click(backdrop);
      fireEvent.keyDown(document, { key: 'Escape' });
      const stillOpen = await Promise.race([
        promise,
        new Promise<'pending'>((r) => setTimeout(() => r('pending'), 50)),
      ]);
      expect(stillOpen).toBe('pending');
      fireEvent.click(screen.getByRole('button', { name: /Move it to this account/i }));
      await expect(promise).resolves.toBe('keep-local');
    });
  });
});

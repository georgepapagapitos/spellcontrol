// @vitest-environment happy-dom
/**
 * The local card-data download is opt-in: nothing fetches it until the user
 * presses the button. The card used to say "Downloading…" to every user who
 * had never opted in, beside a "Refresh card data now" button for data that
 * wasn't there. Its status and button now follow what is actually on the
 * device.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfflineManifest } from '@/lib/offline';

const { offlineState } = vi.hoisted(() => ({
  offlineState: {
    manifest: null as Partial<OfflineManifest> | null,
    stats: null as { cardCount: number; comboCount: number } | null,
    progress: null as { phase: string; fraction: number | null } | null,
    error: null as string | null,
    bootstrapped: true,
    bootstrap: vi.fn(),
    sync: vi.fn(),
    clear: vi.fn(),
  },
}));
vi.mock('@/store/offline', () => ({
  useOfflineStore: (selector: (s: typeof offlineState) => unknown) => selector(offlineState),
}));

import { OfflineModeSettings } from './OfflineModeSettings';

afterEach(() => {
  offlineState.manifest = null;
  offlineState.stats = null;
  offlineState.progress = null;
});

describe('OfflineModeSettings', () => {
  it('says nothing is downloaded, and offers Download, before the user opts in', () => {
    render(<OfflineModeSettings />);
    expect(screen.getByText('Not downloaded.')).toBeTruthy();
    expect(screen.queryByText(/Downloading/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Download card data' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });

  it('says Downloading only while the first download runs', () => {
    offlineState.progress = { phase: 'downloading-cards', fraction: 0.3 };
    render(<OfflineModeSettings />);
    expect(screen.getByText('Downloading cards…')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('offers Refresh and Clear once the data is on the device', () => {
    offlineState.manifest = {
      oracleCardCount: 30000,
      oracleByteSize: 20_000_000,
      combosByteSize: 1_000_000,
      oracleUpdatedAt: Date.now(),
    };
    offlineState.stats = { cardCount: 30000, comboCount: 100 };
    render(<OfflineModeSettings />);
    expect(screen.getByRole('button', { name: 'Refresh card data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear cached card data' })).toBeTruthy();
    // Nothing re-downloads on its own, so the Clear hint must not promise it.
    expect(screen.queryByText(/Re-downloads/)).toBeNull();
    expect(screen.getByText(/^Frees .+ on this device\.$/)).toBeTruthy();
  });
});

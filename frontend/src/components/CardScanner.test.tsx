// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CardScanner } from './CardScanner';
import { useScanQueueStore } from '../lib/use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

// The scanner pulls in the opencv/WASM loader, which can't run under
// happy-dom (see the sibling exclude-list rationale in vitest.config.ts for
// scanner/opencv-loader.ts, scanner/detect.ts, scanner/scan.ts). Mock the
// pipeline's prewarm/scan seam the same way the runtime does.
vi.mock('../lib/scanner/scan', () => ({
  prewarm: vi.fn().mockResolvedValue(undefined),
  scan: vi.fn(),
}));

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'card-1',
    oracle_id: 'oracle-bolt',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    prices: { usd: '1.50' },
    legalities: { commander: 'legal' },
    image_uris: {
      small: '',
      normal: '',
      large: '',
      png: '',
      art_crop: '',
      border_crop: '',
    },
    ...overrides,
  } as ScryfallCard;
}

function installMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value,
  });
}

beforeEach(() => {
  useScanQueueStore.setState({ queue: [] });
});

afterEach(() => {
  installMediaDevices(undefined);
  useScanQueueStore.setState({ queue: [] });
});

describe('CardScanner', () => {
  it('shows the permission-denied error state when the browser refuses camera access', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    installMediaDevices({ getUserMedia });

    render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(
      await screen.findByText(
        'Camera permission denied. Enable it in your browser settings to scan cards.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it("shows 'no camera' guidance when the browser has no camera API at all", async () => {
    installMediaDevices(undefined);

    render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(await screen.findByText("Camera isn't available in this browser.")).toBeTruthy();
  });

  it('shows the queue count badge once cards are queued', async () => {
    // The badge only renders while the camera is live, so the web path has to
    // actually reach 'ready': a stream with one video track, and a play() that
    // resolves (happy-dom has no media element implementation).
    const track = {
      getCapabilities: () => ({}),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    installMediaDevices({ getUserMedia: vi.fn().mockResolvedValue(stream) });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    // happy-dom type-checks srcObject against a real MediaStream; take the
    // validation out of the way so the fake stream can be attached.
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    });
    useScanQueueStore.setState({
      queue: [
        {
          id: 'card-1::nonfoil',
          card: makeCard(),
          qty: 3,
          finish: 'nonfoil',
          rawText: 'Lightning Bolt',
        },
      ],
    });

    render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review 3 scanned cards' })).toBeTruthy()
    );
  });
});

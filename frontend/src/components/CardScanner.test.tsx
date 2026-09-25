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

  describe('camera orientation on a portrait phone', () => {
    // Browsers read width/height in the sensor's landscape terms and rotate
    // frames to the screen. Asking for 1080×1920 made Chrome on Android hand
    // a portrait phone a narrow, zoomed landscape band, reported from a real
    // phone after the web scanner became the only one.
    function liveCamera(settings: { width: number; height: number }) {
      const track = {
        getCapabilities: () => ({}),
        getSettings: () => settings,
        applyConstraints: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
      };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      const getUserMedia = vi.fn().mockResolvedValue(stream);
      installMediaDevices({ getUserMedia });
      HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        writable: true,
        value: null,
      });
      return { getUserMedia, track };
    }

    beforeEach(() => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    });
    afterEach(() => vi.restoreAllMocks());

    it('asks for the sensor-landscape size and leaves a portrait stream alone', async () => {
      const { getUserMedia, track } = liveCamera({ width: 1080, height: 1920 });
      render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

      await screen.findByRole('button', { name: 'Close scanner' });
      const video = getUserMedia.mock.calls[0][0].video;
      expect(video.width).toEqual({ ideal: 1920 });
      expect(video.height).toEqual({ ideal: 1080 });
      expect(track.applyConstraints).not.toHaveBeenCalledWith(
        expect.objectContaining({ width: expect.anything() })
      );
    });

    it('swaps once when the browser still returns a landscape stream', async () => {
      const { track } = liveCamera({ width: 1920, height: 1080 });
      render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

      await screen.findByRole('button', { name: 'Close scanner' });
      expect(track.applyConstraints).toHaveBeenCalledWith({
        width: { ideal: 1080 },
        height: { ideal: 1920 },
      });
    });
  });
});

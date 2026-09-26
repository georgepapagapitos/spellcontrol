// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CardScanner } from './CardScanner';
import { useScanQueueStore } from '../lib/use-scan-queue';
import { useScannerSettings } from '../lib/scanner-settings';
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
      expect(screen.getByRole('button', { name: 'Scanned cards, 3' })).toBeTruthy()
    );
  });

  describe('camera orientation on a portrait phone', () => {
    // Browsers read width/height in the sensor's landscape terms and rotate
    // frames to the screen. Asking for 1080×1920 made Chrome on Android hand
    // a portrait phone a narrow, zoomed landscape band, reported from a real
    // phone after the web scanner became the only one.
    function liveCamera(
      frames: { width: number; height: number },
      settings: { width: number; height: number } = frames
    ) {
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
      // happy-dom has no media dimensions at all; stand in for the frames.
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
        configurable: true,
        get: () => frames.width,
      });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
        configurable: true,
        get: () => frames.height,
      });
      return { getUserMedia, track };
    }

    const reoriented = (track: { applyConstraints: ReturnType<typeof vi.fn> }) =>
      track.applyConstraints.mock.calls.some(([c]) => c && 'width' in c);

    beforeEach(() => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
      delete proto.videoWidth;
      delete proto.videoHeight;
    });

    it('asks for the full 4:3 sensor and leaves a portrait stream alone', async () => {
      const { getUserMedia, track } = liveCamera({ width: 1440, height: 1920 });
      render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

      await screen.findByRole('button', { name: 'Close scanner' });
      const video = getUserMedia.mock.calls[0][0].video;
      expect(video.width).toEqual({ ideal: 1920 });
      expect(video.height).toEqual({ ideal: 1440 });
      expect(reoriented(track)).toBe(false);
    });

    it('swaps once when the frames on screen are still landscape', async () => {
      const { track } = liveCamera({ width: 1920, height: 1440 });
      render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

      await screen.findByRole('button', { name: 'Close scanner' });
      expect(track.applyConstraints).toHaveBeenCalledWith({
        width: { ideal: 1440 },
        height: { ideal: 1920 },
      });
    });

    it('trusts the frames, not settings that report the size unrotated', async () => {
      // Some Android Chrome builds report getSettings() in sensor terms while
      // delivering rotated portrait frames. Swapping on that turned a correct
      // stream into the cropped, zoomed-in one.
      const { track } = liveCamera({ width: 1440, height: 1920 }, { width: 1920, height: 1440 });
      render(<CardScanner onClose={vi.fn()} onConfirm={vi.fn()} />);

      await screen.findByRole('button', { name: 'Close scanner' });
      expect(reoriented(track)).toBe(false);
    });
  });

  describe('with the camera live', () => {
    function liveScanner(onConfirm: (text: string, count: number) => boolean | Promise<boolean>) {
      const track = {
        getCapabilities: () => ({}),
        applyConstraints: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
      };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      installMediaDevices({ getUserMedia: vi.fn().mockResolvedValue(stream) });
      HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
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
            qty: 2,
            finish: 'nonfoil',
            rawText: 'Lightning Bolt',
          },
          {
            id: 'card-2::nonfoil',
            card: makeCard({ id: 'card-2', name: 'Counterspell', collector_number: '54' }),
            qty: 1,
            finish: 'nonfoil',
            condition: 'lp',
            rawText: 'Counterspell',
          },
        ],
      });
      render(<CardScanner onClose={vi.fn()} onConfirm={onConfirm} />);
    }

    async function openList() {
      fireEvent.click(await screen.findByRole('button', { name: 'Scanned cards, 3' }));
      return screen.getByRole('dialog', { name: '3 cards scanned' });
    }

    it('takes the added cards off the list once the add goes through', async () => {
      const onConfirm = vi.fn().mockResolvedValue(true);
      liveScanner(onConfirm);
      const list = await openList();
      fireEvent.click(within(list).getByRole('button', { name: 'Add 3 cards' }));
      expect(onConfirm).toHaveBeenCalledWith(
        '2 Lightning Bolt (LEA) 161\n1 Counterspell *LP* (LEA) 54',
        3
      );
      // Before this, one caller never cleared the list, so the same cards
      // were still there to be added a second time.
      await waitFor(() => expect(useScanQueueStore.getState().queue).toEqual([]));
    });

    it('keeps the cards when the add fails or is only staged', async () => {
      liveScanner(() => false);
      const list = await openList();
      fireEvent.click(within(list).getByRole('button', { name: 'Add 3 cards' }));
      await Promise.resolve();
      expect(useScanQueueStore.getState().queue).toHaveLength(2);
    });

    it('adds only the selected rows and leaves the rest', async () => {
      const onConfirm = vi.fn().mockResolvedValue(true);
      liveScanner(onConfirm);
      const list = await openList();
      fireEvent.click(within(list).getByRole('button', { name: 'More list actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Select cards' }));
      const counterspellBox = within(list)
        .getAllByRole('checkbox')
        .find((b) => b.closest('.scan-row')?.textContent?.includes('Counterspell'));
      fireEvent.click(counterspellBox!);
      fireEvent.click(within(list).getByRole('button', { name: 'Add 1 card' }));
      expect(onConfirm).toHaveBeenCalledWith('1 Counterspell *LP* (LEA) 54', 1);
      await waitFor(() =>
        expect(useScanQueueStore.getState().queue.map((e) => e.id)).toEqual(['card-1::nonfoil'])
      );
    });

    it('shows the count and value, and settings can hide the value', async () => {
      liveScanner(() => true);
      await screen.findByRole('button', { name: 'Scanned cards, 3' });
      expect(document.querySelector('.scanner-tally')?.textContent).toBe('$4.503 cards');
      fireEvent.click(screen.getByRole('button', { name: 'Scanner settings' }));
      const settings = screen.getByRole('dialog', { name: 'Scanner settings' });
      fireEvent.click(within(settings).getByRole('switch', { name: 'Show the running total' }));
      expect(useScannerSettings.getState().showTotal).toBe(false);
      expect(document.querySelector('.scanner-tally')?.textContent).toBe('3 cards');
      useScannerSettings.setState({ showTotal: true });
    });
  });
});

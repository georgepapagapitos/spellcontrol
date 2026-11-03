import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import {
  assertWriteFloor,
  extractArtUrl,
  readRecordCount,
  fetchArtBytes,
  BASELINE_RECORD_COUNT,
} from './ingest-guards';
import { ingestCardHashes, packBinary } from './hash-ingest';

const cardsHolder = vi.hoisted(() => ({ cards: [] as unknown[] }));
vi.mock('../scryfall-bulk', () => ({
  fetchScryfallBulkEntry: vi.fn(),
  streamBulkJsonl: async function* () {
    for (const c of cardsHolder.cards) yield c;
  },
}));

const UUID = '00000000-0000-4000-8000-000000000001';

describe('extractArtUrl', () => {
  it('reads art when only the new keys exist', () => {
    expect(extractArtUrl({ image_uris: { art: 'https://x/art/a.webp' } })).toBe(
      'https://x/art/a.webp'
    );
  });
  it('reads art_crop when only the old keys exist', () => {
    expect(extractArtUrl({ image_uris: { art_crop: 'https://x/art_crop/a.jpg' } })).toBe(
      'https://x/art_crop/a.jpg'
    );
  });
  it('prefers art when both exist', () => {
    expect(
      extractArtUrl({ image_uris: { art: 'https://x/art/a.webp', art_crop: 'https://x/a.jpg' } })
    ).toBe('https://x/art/a.webp');
  });
  it('falls back to face 0 with the same preference, and to null', () => {
    expect(extractArtUrl({ card_faces: [{ image_uris: { art: 'https://x/f0.webp' } }] })).toBe(
      'https://x/f0.webp'
    );
    expect(extractArtUrl({ card_faces: [{ image_uris: { art_crop: 'https://x/f0.jpg' } }] })).toBe(
      'https://x/f0.jpg'
    );
    expect(extractArtUrl({ image_uris: { small: 'x' } } as never)).toBeNull();
  });
});

describe('write floor', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-floor-'));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const fakeHashes = (n: number) =>
    packBinary(Array.from({ length: n }, () => ({ hash: 1n, uuid: Buffer.alloc(16, 1) })));

  it('reads the count from the header and null for a short or missing file', async () => {
    const p = path.join(dir, 'a.bin');
    await fs.writeFile(p, fakeHashes(7));
    expect(await readRecordCount(p)).toBe(7);
    await fs.writeFile(p, 'version https://git-lfs');
    expect(await readRecordCount(p)).toBeNull();
    expect(await readRecordCount(path.join(dir, 'missing.bin'))).toBeNull();
  });

  it('refuses a count under 90% of the previous file, accepts 90%', async () => {
    const p = path.join(dir, 'a.bin');
    await fs.writeFile(p, fakeHashes(100));
    await expect(assertWriteFloor({ label: 't', outPath: p, newCount: 89 })).rejects.toThrow(
      /refusing to replace/
    );
    await expect(
      assertWriteFloor({ label: 't', outPath: p, newCount: 90 })
    ).resolves.toBeUndefined();
  });

  it('uses the committed baseline when there is no previous file', async () => {
    const p = path.join(dir, 'none.bin');
    await expect(assertWriteFloor({ label: 't', outPath: p, newCount: 5 })).rejects.toThrow(
      /committed baseline/
    );
    await expect(
      assertWriteFloor({ label: 't', outPath: p, newCount: BASELINE_RECORD_COUNT })
    ).resolves.toBeUndefined();
  });

  it('skips the floor for a deliberate --limit run', async () => {
    const p = path.join(dir, 'a.bin');
    await fs.writeFile(p, fakeHashes(100));
    await expect(
      assertWriteFloor({ label: 't', outPath: p, newCount: 1, limited: true })
    ).resolves.toBeUndefined();
  });

  it('hash ingest that writes 10% of the previous count rejects and leaves the old file untouched', async () => {
    const out = path.join(dir, 'card-hashes.bin');
    const old = fakeHashes(10);
    await fs.writeFile(out, old);
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#778899' },
    })
      .png()
      .toBuffer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(png, { status: 200 }))
    );
    // One card with only the new key: proves ingest reads `art`, then trips the floor (1 of 10).
    cardsHolder.cards = [{ id: UUID, image_uris: { art: 'https://cards.scryfall.io/art/a.webp' } }];
    await expect(
      ingestCardHashes({ outPath: out, bulkDownloadUrl: 'https://example.test/bulk' })
    ).rejects.toThrow(/refusing to replace/);
    expect(Buffer.compare(await fs.readFile(out), old)).toBe(0);
    await expect(fs.access(`${out}.tmp`)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledWith('https://cards.scryfall.io/art/a.webp', expect.anything());
  });
});

describe('fetchArtBytes', () => {
  afterEach(() => vi.restoreAllMocks());
  const ok = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

  it('retries a transient failure and returns the bytes', async () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('other side closed'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok());
    const bytes = await fetchArtBytes('https://x/a.webp', 'ua', 1000, { backoffMs: 0 });
    expect(new Uint8Array(bytes!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts by throwing', async () => {
    const spy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('other side closed'));
    await expect(
      fetchArtBytes('https://x/a.webp', 'ua', 1000, { maxAttempts: 2, backoffMs: 0 })
    ).rejects.toThrow('other side closed');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns null without retrying on a 404', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    expect(await fetchArtBytes('https://x/a.webp', 'ua', 1000, { backoffMs: 0 })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

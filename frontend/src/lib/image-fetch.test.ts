import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchImagesAsDataUrls } from './image-fetch';

// Minimal Blob/FileReader shims that work in node's vitest environment.
// jsdom would also work but we don't need a full DOM here.
function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' });
}

function mockFetch(byUrl: Record<string, string | Error>) {
  return vi.fn(async (url: string) => {
    const v = byUrl[url];
    if (v instanceof Error) throw v;
    if (v === undefined) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      status: 200,
      blob: async () => makeBlob(v),
    } as Response;
  });
}

describe('fetchImagesAsDataUrls', () => {
  beforeEach(() => {
    // FileReader from jsdom is fine, but vitest's default env is node. Provide a shim.
    if (typeof globalThis.FileReader === 'undefined') {
      class ShimFileReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(blob: Blob) {
          blob.text().then((text) => {
            this.result = `data:${blob.type};base64,${btoa(text)}`;
            this.onload?.();
          });
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = ShimFileReader;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a data URL for each successfully fetched image', async () => {
    const fetchSpy = mockFetch({
      'https://x/a.jpg': 'A-bytes',
      'https://x/b.jpg': 'B-bytes',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchImagesAsDataUrls(['https://x/a.jpg', 'https://x/b.jpg']);

    expect(result.size).toBe(2);
    expect(result.get('https://x/a.jpg')).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.get('https://x/b.jpg')).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('dedupes input URLs so the same image is fetched once', async () => {
    const fetchSpy = mockFetch({ 'https://x/a.jpg': 'A' });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchImagesAsDataUrls(['https://x/a.jpg', 'https://x/a.jpg', 'https://x/a.jpg']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips falsy entries', async () => {
    const fetchSpy = mockFetch({ 'https://x/a.jpg': 'A' });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchImagesAsDataUrls(['', 'https://x/a.jpg', '']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://x/a.jpg');
  });

  it('silently drops failed fetches but resolves the rest', async () => {
    const fetchSpy = mockFetch({
      'https://x/a.jpg': 'A',
      'https://x/missing.jpg': new Error('network down'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchImagesAsDataUrls(['https://x/a.jpg', 'https://x/missing.jpg']);

    expect(result.has('https://x/a.jpg')).toBe(true);
    expect(result.has('https://x/missing.jpg')).toBe(false);
  });

  it('drops non-ok responses silently', async () => {
    const fetchSpy = mockFetch({ 'https://x/a.jpg': 'A' /* b.jpg → 404 */ });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchImagesAsDataUrls(['https://x/a.jpg', 'https://x/b.jpg']);

    expect(result.has('https://x/a.jpg')).toBe(true);
    expect(result.has('https://x/b.jpg')).toBe(false);
  });

  it('reports progress as work completes', async () => {
    const fetchSpy = mockFetch({
      'https://x/a.jpg': 'A',
      'https://x/b.jpg': 'B',
      'https://x/missing.jpg': new Error('boom'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onProgress = vi.fn();
    await fetchImagesAsDataUrls(
      ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/missing.jpg'],
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it('returns empty map when given no urls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchImagesAsDataUrls([]);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

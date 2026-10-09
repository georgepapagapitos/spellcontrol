import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// vite-plugin-pwa used to emit these two files. It was dropped once the PWA
// had been retired for months, so they now live in public/ by hand. A browser
// still holding the pre-#482 worker only frees itself by fetching a real
// /sw.js that unregisters it (a 404, or the SPA fallback's index.html, fails
// the update check and keeps the old worker), and "Add to home screen" only
// gets a name and icon through the manifest link. Either is easy to delete as
// dead weight, so pin both.
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p: string[]) => readFileSync(resolve(frontend, ...p), 'utf8');

describe('retired service worker assets', () => {
  it('public/sw.js unregisters itself, clears caches and reloads open tabs', async () => {
    const handlers: Record<string, () => void> = {};
    class WindowClient {
      url = 'https://example.test/decks';
      navigate = vi.fn();
    }
    const client = new WindowClient();
    const cacheDelete = vi.fn().mockResolvedValue(true);
    const self = {
      addEventListener: (type: string, fn: () => void) => (handlers[type] = fn),
      skipWaiting: vi.fn(),
      registration: { unregister: vi.fn().mockResolvedValue(true) },
      clients: { matchAll: vi.fn().mockResolvedValue([client]) },
      caches: { keys: vi.fn().mockResolvedValue(['workbox-precache-v2']), delete: cacheDelete },
    };
    new Function('self', 'WindowClient', read('public', 'sw.js'))(self, WindowClient);

    handlers.install();
    expect(self.skipWaiting).toHaveBeenCalledOnce();

    handlers.activate();
    await vi.waitFor(() => expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v2'));
    expect(self.registration.unregister).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith(client.url);
  });

  it('index.html links a manifest whose icons exist', () => {
    expect(read('index.html')).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    const manifest = JSON.parse(read('public', 'manifest.webmanifest')) as {
      name: string;
      icons: { src: string }[];
    };
    expect(manifest.name).toBe('SpellControl');
    for (const icon of manifest.icons) expect(() => read('public', `.${icon.src}`)).not.toThrow();
  });
});

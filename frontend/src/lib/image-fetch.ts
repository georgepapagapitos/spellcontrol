/**
 * Fetch a batch of image URLs and return them as data URLs, suitable for
 * embedding in a jsPDF document via `addImage`. Dedupes the input, caps
 * concurrency to be polite to Scryfall's CDN, and silently drops failures
 * so the caller can fall back to a text representation per missing entry.
 *
 * The `onProgress` callback fires after each completed (or failed) URL with
 * the running count and total. Useful for surfacing a progress indicator.
 */
export async function fetchImagesAsDataUrls(
  urls: string[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<Map<string, string>> {
  const concurrency = opts.concurrency ?? 12;
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const result = new Map<string, string>();
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          result.set(url, dataUrl);
        }
      } catch {
        // Swallow — missing image just falls back to the text cell.
      } finally {
        done++;
        opts.onProgress?.(done, unique.length);
      }
    }
  }

  const workerCount = Math.min(concurrency, unique.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

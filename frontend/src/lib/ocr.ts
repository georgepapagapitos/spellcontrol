import type { Worker } from 'tesseract.js';

/**
 * In-browser OCR for the card scanner. We lazy-load Tesseract.js so the ~2MB
 * worker bundle never touches the initial page load — it's only fetched when
 * the user actually opens the scanner.
 *
 * Why Tesseract over a perceptual-hash matcher (Manabox/Delver Lens style):
 * shipping a ~30k-image hash database to the browser isn't viable, but MTG
 * card titles are large, high-contrast, in a single bold font — Tesseract
 * with the default English model recognizes them reliably from a ~300px-wide
 * crop. The OCR output is then handed to Scryfall's fuzzy /cards/named
 * endpoint, which is purpose-built for human-imperfect input and forgives the
 * occasional misread character.
 */

let workerPromise: Promise<Worker> | null = null;

/** Loads (or returns) a singleton Tesseract worker, initialised for English. */
async function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      // Tesseract logs a steady stream of progress events — silence by default.
      logger: () => {},
    });
    // Card titles are a single line of text. Pre-setting page-seg mode 7
    // ("Treat the image as a single text line") boosts accuracy on the
    // narrow title strip we crop.
    await worker.setParameters({
      tessedit_pageseg_mode: '7' as unknown as never,
      // Card title fonts only use these characters. Restricting the charset
      // dramatically reduces OCR errors (no more "0" vs "O" confusion).
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,/",
    });
    return worker;
  })();
  return workerPromise;
}

/**
 * Eagerly warms the OCR worker. Call this when the scanner UI opens so the
 * first capture isn't blocked on a cold-start download.
 */
export function warmOcr(): void {
  void getWorker().catch(() => {
    workerPromise = null;
  });
}

/** Releases the worker. Call on scanner unmount to free memory. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // ignore
  } finally {
    workerPromise = null;
  }
}

/**
 * Runs OCR on an image (canvas, blob, or data URL) and returns the recognised
 * text plus a 0–100 confidence score. The caller is responsible for cropping
 * to the title region before calling — feeding the whole card hurts accuracy.
 */
export async function recognizeText(
  source: HTMLCanvasElement | Blob | string
): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker();
  const { data } = await worker.recognize(source);
  return {
    text: (data.text || '').replace(/\s+/g, ' ').trim(),
    confidence: data.confidence ?? 0,
  };
}

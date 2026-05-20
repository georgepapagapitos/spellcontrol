import type { Worker } from 'tesseract.js';
import { isNativePlatform } from './platform';

/**
 * Card-scanner OCR. Two implementations behind a single API:
 *   • Web: lazy-loaded Tesseract.js (~2MB WASM worker, fetched only when the
 *     scanner opens).
 *   • Native (Capacitor): Google ML Kit text recognition via a native plugin.
 *     Pre-installed with the OS, dramatically faster, much more accurate
 *     than Tesseract on phone-camera captures.
 * The branch happens inside each exported function so callers see the same
 * surface regardless of platform.
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
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,/",
    });
    return worker;
  })();
  return workerPromise;
}

/**
 * Eagerly warms the OCR worker. Call this when the scanner UI opens so the
 * first capture isn't blocked on a cold-start download. ML Kit on native is
 * preloaded by the OS, so this is a no-op there.
 */
export function warmOcr(): void {
  if (isNativePlatform()) return;
  void getWorker().catch(() => {
    workerPromise = null;
  });
}

/** Releases the worker. Call on scanner unmount to free memory. */
export async function disposeOcr(): Promise<void> {
  if (isNativePlatform()) return;
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

function canvasToBase64Png(canvas: HTMLCanvasElement): string {
  // dataURL is "data:image/png;base64,XXXX" — the plugin wants just XXXX.
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Runs OCR on an image (canvas, blob, or data URL) and returns the recognised
 * text plus a 0–100 confidence score. The caller is responsible for cropping
 * to the title region before calling — feeding the whole card hurts accuracy
 * on Tesseract and is wasted resolution on ML Kit.
 *
 * On native ML Kit doesn't expose a per-result confidence; we surface a high
 * fixed value (95) because in practice its empty/garbage outputs are caught
 * by the downstream `text.length < 2` guard rather than by a threshold.
 */
export async function recognizeText(
  source: HTMLCanvasElement | Blob | string
): Promise<{ text: string; confidence: number }> {
  if (isNativePlatform()) {
    if (!(source instanceof HTMLCanvasElement)) {
      throw new Error('Native OCR currently expects an HTMLCanvasElement source.');
    }
    const { CapacitorPluginMlKitTextRecognition } =
      await import('@pantrist/capacitor-plugin-ml-kit-text-recognition');
    const { text } = await CapacitorPluginMlKitTextRecognition.detectText({
      base64Image: canvasToBase64Png(source),
    });
    return {
      text: (text || '').replace(/\s+/g, ' ').trim(),
      confidence: text ? 95 : 0,
    };
  }
  const worker = await getWorker();
  const { data } = await worker.recognize(source);
  return {
    text: (data.text || '').replace(/\s+/g, ' ').trim(),
    confidence: data.confidence ?? 0,
  };
}

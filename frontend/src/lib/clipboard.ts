/**
 * The one place that calls `navigator.clipboard.writeText` (STYLE_GUIDE §
 * Verbs — Copy). Everything that copies plain text to the clipboard goes
 * through this function or through `useCopyFeedback`/`CopyButton`
 * (`components/shared/CopyButton.tsx`), which both call it internally — so a
 * denied clipboard (an insecure origin, a WebView that refuses) fails the
 * same way everywhere instead of each call site inventing its own try/catch.
 * `src/test/no-direct-clipboard-write.test.ts` enforces it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

import { FilePicker } from '@capawesome/capacitor-file-picker';
import { isNativePlatform } from './platform';

interface PickOptions {
  /** MIME types passed to the native picker. Ignored on web. */
  types?: string[];
  /** Whether to allow multiple selections. Plugin limits this to all-or-one. */
  multiple?: boolean;
}

/**
 * Open the native document picker and return the chosen files as `File`
 * instances so the rest of the import pipeline (`File.text()`, blob staging,
 * etc.) doesn't need to know which platform it's running on.
 *
 * Returns an empty array when the user cancels — never throws on cancel,
 * never throws on a missing file.
 *
 * **Why this exists.** Android's WebView-mediated `<input type="file">`
 * routes through the "select a source" intent picker, which has a
 * jarring extra tap and shows mostly-irrelevant apps (gallery, camera).
 * The plugin uses `ACTION_OPEN_DOCUMENT` directly, which opens the
 * system document picker straight to Files / Drive / Downloads — much
 * closer to what desktop users expect.
 *
 * On web, prefer the existing `<input type="file">` callsites; this
 * function still works there (the plugin falls back to a synthesized
 * input) but the dedicated input gives us drag-and-drop, multi-select,
 * and Esc handling for free.
 */
export async function pickNativeFiles(options: PickOptions = {}): Promise<File[]> {
  if (!isNativePlatform()) return [];

  const result = await FilePicker.pickFiles({
    types: options.types,
    limit: options.multiple ? 0 : 1,
    // Read bytes natively and hand them back as base64. We used to fetch
    // the returned `content://` / `file://` URI to materialise a Blob,
    // but `CapacitorHttp.enabled: true` intercepts window.fetch and only
    // understands http(s) — non-HTTP schemes fail with "Failed to fetch".
    // Going through readData keeps everything inside the plugin's JS↔native
    // bridge, no fetch involved. Memory cost: ~33% inflation for base64
    // transport; fine for the CSV/TSV/TXT/JSON files this picker imports.
    readData: true,
  });

  return Promise.all(
    result.files.map(async (picked) => {
      // Web fallback returns a real Blob directly.
      if (picked.blob) {
        return new File([picked.blob], picked.name, {
          type: picked.mimeType || 'application/octet-stream',
          lastModified: picked.modifiedAt ?? Date.now(),
        });
      }
      if (picked.data) {
        // Native path: base64 → bytes → Blob → File. `atob` decodes the
        // base64 envelope; the loop builds a Uint8Array because Blob()
        // wants array-buffer-like input, not a binary string.
        const binary = atob(picked.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const mime = picked.mimeType || 'application/octet-stream';
        const blob = new Blob([bytes], { type: mime });
        return new File([blob], picked.name, {
          type: mime,
          lastModified: picked.modifiedAt ?? Date.now(),
        });
      }
      throw new Error(`Picker returned no data for "${picked.name}".`);
    })
  );
}

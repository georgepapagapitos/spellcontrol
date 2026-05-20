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
    readData: false,
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
      if (picked.path) {
        // On Android/iOS the path is a content:// or file:// URI that the
        // WebView's fetch can read directly. Materializing into a Blob
        // matches the shape `File.text()` and the parser pipeline expect.
        const resp = await fetch(picked.path);
        const blob = await resp.blob();
        return new File([blob], picked.name, {
          type: picked.mimeType || blob.type || 'application/octet-stream',
          lastModified: picked.modifiedAt ?? Date.now(),
        });
      }
      throw new Error(`Picker returned no data for "${picked.name}".`);
    })
  );
}

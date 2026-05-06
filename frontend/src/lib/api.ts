import type { UploadResponse } from '../types';

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let msg = `Request failed: HTTP ${response.status}`;
    try {
      const err = await response.json();
      if (err.error) msg = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await response.json()) as T;
}

/** Import via file upload (CSV, TSV, or text). */
export async function importFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/import', { method: 'POST', body: formData });
  return handle<UploadResponse>(response);
}

/** Import via pasted text — MTGA format, plain card names, or CSV-as-text. */
export async function importText(text: string): Promise<UploadResponse> {
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handle<UploadResponse>(response);
}

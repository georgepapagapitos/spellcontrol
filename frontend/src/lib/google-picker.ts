import { isNativePlatform } from './platform';

/**
 * Google Drive file picker — the real "open my Drive" flow.
 *
 * Runs entirely client-side: Google's own Picker UI hands back a file id, and
 * we pull the bytes with the short-lived token the user just granted. Nothing
 * touches our backend, so there is no server-side copy of anyone's Drive
 * credentials to protect.
 *
 * **Scope is `drive.file`, deliberately.** It grants access only to the files
 * the user explicitly picks in that dialog — not "read my Drive". That is also
 * why it avoids the security assessment `drive.readonly` would drag in.
 *
 * **Web only.** Google refuses OAuth inside embedded WebViews, so this cannot
 * run in the Capacitor app. Native is not left short: its system document
 * picker already lists Drive (see `native-file-picker.ts`), and the pasted-link
 * path still covers native Sheets. `googlePickerAvailable()` is the gate.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GAPI_SRC = 'https://apis.google.com/js/api.js';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/** Mirrors the server-side ceiling in `backend/src/import-link.ts`. */
const MAX_BYTES = 5_000_000;

/** The file types a card list actually arrives as. */
const PICKABLE_MIMES = [
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'application/json',
  SHEET_MIME,
].join(',');

/** True when the build carries Picker credentials at all. */
export function googlePickerConfigured(): boolean {
  return Boolean(API_KEY && CLIENT_ID);
}

/**
 * True when the Picker can actually run here. Keep every call site behind this
 * — an un-keyed build or the native app must fall back, not render a button
 * that throws when tapped.
 */
export function googlePickerAvailable(): boolean {
  return googlePickerConfigured() && !isNativePlatform();
}

// ── script loading ──────────────────────────────────────────────────────────
const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = loaded.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a failed load be retried — a dropped connection shouldn't wedge
      // the button for the rest of the session.
      loaded.delete(src);
      reject(new Error("Couldn't reach Google. Check your connection and try again."));
    };
    document.head.appendChild(el);
  });
  loaded.set(src, p);
  return p;
}

// ── minimal typings for the two Google globals ──────────────────────────────
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface PickedDoc {
  id: string;
  name: string;
  mimeType: string;
}

type Win = Window & {
  gapi?: { load(name: string, cb: () => void): void };
  // The Picker and GIS surfaces are large, untyped and load at runtime;
  // narrowing them here would be fiction. Access goes through `g()`.
  google?: unknown;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = () => (window as Win).google as any;

// ── token ───────────────────────────────────────────────────────────────────
let token: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Reuse while comfortably valid so picking a second file doesn't re-prompt.
  if (token && token.expiresAt - Date.now() > 60_000) return token.value;
  await loadScript(GIS_SRC);
  return new Promise<string>((resolve, reject) => {
    const client = g().accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (r: TokenResponse) => {
        if (!r.access_token) {
          reject(
            new Error(r.error ? `Google declined access (${r.error}).` : 'No access granted.')
          );
          return;
        }
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: { type?: string }) => {
        // Closing the consent popup is a normal outcome, not a failure to
        // shout about — an empty message tells the caller to stay quiet.
        reject(new Error(e?.type === 'popup_closed' ? '' : "Couldn't get permission from Google."));
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ── download ────────────────────────────────────────────────────────────────
async function download(doc: PickedDoc, accessToken: string): Promise<File> {
  const isSheet = doc.mimeType === SHEET_MIME;
  // A Google Sheet has no bytes of its own — it has to be exported. Anything
  // else (an uploaded .csv/.txt) is fetched as-is.
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=text%2Fcsv`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(
      res.status === 403 || res.status === 404
        ? `Google wouldn't return “${doc.name}”. Try picking it again.`
        : `Couldn't download “${doc.name}” (HTTP ${res.status}).`
    );
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`“${doc.name}” is too big to import — over 5 MB of text.`);
  }
  const name = isSheet && !/\.csv$/i.test(doc.name) ? `${doc.name}.csv` : doc.name;
  return new File([text], name, { type: 'text/csv' });
}

// ── the picker itself ───────────────────────────────────────────────────────
function showPicker(accessToken: string): Promise<PickedDoc[]> {
  return new Promise((resolve, reject) => {
    (window as Win).gapi!.load('picker', () => {
      try {
        const picker = g().picker;
        const view = new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)
          .setMimeTypes(PICKABLE_MIMES);
        new picker.PickerBuilder()
          .setDeveloperKey(API_KEY!)
          .setOAuthToken(accessToken)
          .addView(view)
          .enableFeature(picker.Feature.MULTISELECT_ENABLED)
          .setTitle('Choose a card list')
          .setCallback((data: Record<string, unknown>) => {
            const action = data[picker.Response.ACTION];
            // Anything that is neither PICKED nor CANCEL (e.g. the loaded
            // notification) is a progress event — ignore it and keep waiting.
            if (action === picker.Action.PICKED) {
              resolve((data[picker.Response.DOCUMENTS] as PickedDoc[]) ?? []);
            } else if (action === picker.Action.CANCEL) {
              resolve([]);
            }
          })
          .build()
          .setVisible(true);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to open the Drive picker.'));
      }
    });
  });
}

/**
 * Open the user's Drive and return whatever they chose as ordinary `File`s, so
 * every caller can hand the result to the same staging path a drag-drop uses.
 * Resolves to `[]` when the user cancels — cancelling is not an error.
 */
export async function pickFromGoogleDrive(): Promise<File[]> {
  if (!googlePickerAvailable()) return [];
  await loadScript(GAPI_SRC);
  const accessToken = await getAccessToken();
  const docs = await showPicker(accessToken);
  if (docs.length === 0) return [];
  return Promise.all(docs.map((d) => download(d, accessToken)));
}

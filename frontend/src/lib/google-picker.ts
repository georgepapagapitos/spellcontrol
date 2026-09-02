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
 *
 * ⛔ **The API key must NOT carry a Websites (HTTP referrer) restriction.** The
 * Picker's backend never receives the hosting page's `Referer`, so such a
 * restriction can never match and every open fails with the misleading "The API
 * developer key is invalid". Restrict the key by *API* instead (Picker + Drive)
 * — see `.env.example`. Two response headers also have to cooperate; both are
 * pinned by `backend/src/security-headers.test.ts`.
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

/**
 * The user backed out. A distinct type, NOT an Error with an empty message:
 * the empty-string convention this replaces meant "stay quiet", and it silently
 * swallowed a real abort — the user authorised, the flow gave up, and nothing
 * appeared or was logged. Callers must special-case cancellation explicitly.
 */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError;
}

/** True when the build carries Picker credentials at all. */
export function googlePickerConfigured(): boolean {
  return Boolean(API_KEY && CLIENT_ID);
}

/**
 * The Cloud project number, which the Picker needs as its "app id" whenever the
 * `drive.file` scope is used — it is how Drive knows which app to grant the
 * picked file to. It is the leading numeric segment of the OAuth client id
 * (`<projectNumber>-<hash>.apps.googleusercontent.com`), so it needs no second
 * env var and cannot drift out of sync with the client it belongs to.
 */
function appId(): string {
  return CLIENT_ID?.split('-')[0] ?? '';
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

/**
 * Grace period after the consent popup closes before we call it a cancel.
 *
 * `popup_closed` fires when the consent window goes away — which also happens
 * on a SUCCESSFUL grant, and it can arrive before the token callback. Treating
 * it as an immediate cancel aborted the whole flow *after* the user had already
 * authorised: they got signed in, then nothing opened. Waiting briefly lets the
 * token that is already on its way win the race.
 */
const POPUP_CLOSED_GRACE_MS = 1500;

/**
 * Google's two scripts, loaded ahead of the click.
 *
 * **This is why the button exists at all.** A browser only allows a popup while
 * a user gesture is still "active", and awaiting a network round-trip spends
 * that activation. Awaiting the gapi + GIS loads inside the click handler and
 * *then* calling `requestAccessToken()` got the consent popup blocked outright
 * — "Opening multiple popups was blocked due to lack of user activation" — so
 * nothing ever opened. Warming them up front means the click reaches
 * `requestAccessToken()` with the activation intact.
 */
export function warmGooglePicker(): void {
  if (!googlePickerAvailable()) return;
  // Fire and forget: a failure here just means the click path awaits instead,
  // and it must never surface as an error the user didn't ask for.
  void loadScript(GAPI_SRC).catch(() => {});
  void loadScript(GIS_SRC).catch(() => {});
}

/** True once both scripts are in place, i.e. the click path needs no `await`. */
function isWarm(): boolean {
  const w = window as Win;
  return Boolean(w.gapi && (w.google as { accounts?: unknown } | undefined)?.accounts);
}

async function getAccessToken(): Promise<string> {
  // Reuse while comfortably valid so picking a second file doesn't re-prompt.
  if (token && token.expiresAt - Date.now() > 60_000) return token.value;
  // Only await when the warm-up hasn't landed yet — see warmGooglePicker.
  if (!isWarm()) await loadScript(GIS_SRC);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const client = g().accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (r: TokenResponse) => {
        if (!r.access_token) {
          finish(() =>
            reject(
              new Error(r.error ? `Google declined access (${r.error}).` : 'No access granted.')
            )
          );
          return;
        }
        // Bind before the closure — the narrowing from the guard above doesn't
        // survive into a deferred callback.
        const granted = r.access_token;
        token = { value: granted, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
        finish(() => resolve(granted));
      },
      error_callback: (e: { type?: string }) => {
        if (e?.type === 'popup_closed') {
          // Might be a cancel, might be a grant whose token is still in flight
          // — see POPUP_CLOSED_GRACE_MS. `settled` makes the late token win.
          setTimeout(
            () =>
              finish(() => {
                // Reaching here means the popup closed and no token EVER
                // arrived. Usually a real cancel, but it is also what a
                // severed opener looks like (see the COOP note in
                // backend/src/server.ts) — and that spent three rounds
                // looking like "nothing happens". The UI stays quiet, but
                // never let it be undiagnosable.
                // eslint-disable-next-line no-console
                console.debug('[drive-picker] popup closed with no token — treating as cancel');
                reject(new CancelledError());
              }),
            POPUP_CLOSED_GRACE_MS
          );
          return;
        }
        // A blocked popup is a browser setting, not a bug the user can act on
        // from a generic message — name the actual remedy.
        if (e?.type === 'popup_failed_to_open') {
          finish(() =>
            reject(
              new Error(
                'Your browser blocked Google’s sign-in window. Allow pop-ups for this site, then try again.'
              )
            )
          );
          return;
        }
        finish(() =>
          reject(new Error(`Couldn't get permission from Google (${e?.type ?? 'unknown'}).`))
        );
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
        : `Couldn't download “${doc.name}” from Google Drive. Try picking it again.`
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
/** How long to wait for the picker library before admitting it never arrived.
 *  Without this, a `gapi.load` that never calls back leaves the promise hanging
 *  and the button stuck on "Opening…" with nothing to diagnose. */
const PICKER_LOAD_TIMEOUT_MS = 15_000;

function showPicker(accessToken: string): Promise<PickedDoc[]> {
  return new Promise((resolve, reject) => {
    let loaded = false;
    setTimeout(() => {
      if (!loaded) reject(new Error("Google's file picker didn't finish loading."));
    }, PICKER_LOAD_TIMEOUT_MS);

    (window as Win).gapi!.load('picker', () => {
      loaded = true;
      try {
        const picker = g().picker;
        if (!picker?.PickerBuilder) {
          throw new Error("Google's file picker library loaded but exposed no API.");
        }
        const view = new picker.DocsView(picker.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)
          .setMimeTypes(PICKABLE_MIMES);
        const builder = new picker.PickerBuilder()
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
              reject(new CancelledError());
            }
          });
        // Required with drive.file: without the app id Drive has no app to
        // grant the picked file to, and the download 403s later.
        const id = appId();
        if (id) builder.setAppId(id);
        builder.build().setVisible(true);
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Couldn't open the Google Drive picker. Try again.")
        );
      }
    });
  });
}

/**
 * Open the user's Drive and return whatever they chose as ordinary `File`s, so
 * every caller can hand the result to the same staging path a drag-drop uses.
 *
 * Throws {@link CancelledError} when the user backs out — check `isCancelled`
 * rather than inspecting messages. Every other failure throws a real Error AND
 * logs it: this flow spans two Google libraries, a popup and an iframe, so a
 * failure nobody can see is the expensive kind. It stayed silent once already.
 */
/**
 * The pick currently in flight, if any.
 *
 * A React `busy` flag cannot guard this: `setDriveBusy(true)` is asynchronous,
 * so two quick clicks both read `false`, both start a flow, and both call
 * `requestAccessToken()` — the browser blocks the second with "Opening multiple
 * popups was blocked due to lack of user activation", and the user sees
 * nothing open. Guarding at the module means every call site is covered,
 * including any added later.
 */
let inFlight: Promise<File[]> | null = null;

export function pickFromGoogleDrive(): Promise<File[]> {
  if (!googlePickerAvailable()) return Promise.resolve([]);
  if (inFlight) return inFlight;
  inFlight = runPick().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runPick(): Promise<File[]> {
  try {
    // getAccessToken FIRST, and with no await before it when warm — the popup
    // it opens needs this click's user activation, and awaiting the gapi load
    // here is exactly what spent it. gapi is only needed later, for the picker
    // iframe, which is not popup-gated.
    const accessToken = await getAccessToken();
    await loadScript(GAPI_SRC);
    const docs = await showPicker(accessToken);
    if (docs.length === 0) return [];
    return await Promise.all(docs.map((d) => download(d, accessToken)));
  } catch (err) {
    if (!isCancelled(err)) {
      // This flow spans two Google libraries, a popup and a cross-origin
      // iframe, none of which we can instrument. It failed silently in
      // production once; the console is the only place a user can read back
      // what actually went wrong.
      // eslint-disable-next-line no-console
      console.error('[drive-picker] failed:', err);
    }
    throw err;
  }
}

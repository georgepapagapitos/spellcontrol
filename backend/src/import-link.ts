/**
 * Fetch an import list from a Google Sheets / Drive share link.
 *
 * **Why the server does the fetching.** Google's export endpoints send no CORS
 * headers, so the browser can't read them. The client hands us a link, we hand
 * back the raw text, and the client stages it as an ordinary `File` — the rest
 * of the import pipeline (parse, chunk, resolve, route) never learns it came
 * from Drive.
 *
 * **Why the host allowlist is load-bearing.** This is a server-side fetch of a
 * user-supplied URL — an SSRF boundary. The allowlist *is* the boundary; don't
 * widen it without deciding what the new host can be pointed at.
 *
 * No OAuth, no Drive API, no extra scope: this reads only what "anyone with the
 * link" can already read. A private file comes back as Google's sign-in page,
 * which we detect and turn into a sharing hint.
 */

const ALLOWED_HOSTS = new Set(['docs.google.com', 'drive.google.com']);

/** Card lists are text. Generous for a 100k-row CSV, and still bounds what a
 *  mis-pasted link to a 2 GB Drive video can do to the machine. */
const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 20_000;

const SHARE_HINT =
  'Google wouldn\'t hand that file over. Open it, hit Share, and set access to "Anyone with the link".';
const TOO_BIG_HINT = "That file is too big to import — it's over 5 MB of text.";

/** A problem with the link itself — the message is safe to show the user. */
export class ImportLinkError extends Error {}

/**
 * Turn a share link into the URL that actually serves bytes.
 *
 * Sheets: `/spreadsheets/d/<id>/edit#gid=<gid>` → the CSV export of that tab.
 * Drive:  `/file/d/<id>/view`, `/open?id=<id>`, `/uc?id=<id>` → the download.
 */
export function resolveImportUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportLinkError("That doesn't look like a link.");
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new ImportLinkError('Only Google Sheets and Google Drive links can be imported.');
  }

  const sheetId = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (sheetId) {
    // The tab id lives in the fragment on a normal share link (#gid=0) and in
    // the query on a copied export link. Absent → Google serves the first tab.
    const gid = url.searchParams.get('gid') ?? url.hash.match(/gid=(\d+)/)?.[1];
    const out = new URL(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export`
    );
    out.searchParams.set('format', 'csv');
    if (gid) out.searchParams.set('gid', gid);
    return out.toString();
  }

  const fileId = url.pathname.match(/^\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id');
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  throw new ImportLinkError(
    "Couldn't find a file in that link — paste the link to a Sheet, or to a single file in Drive."
  );
}

/**
 * Content-Disposition carries the real name: the doc title for a Sheets export,
 * the filename for a Drive download. Worth parsing — it's what the user sees in
 * the staged list and, afterwards, in their import history.
 */
function filenameFrom(header: string | null): string {
  const fallback = 'google-import.csv';
  if (!header) return fallback;
  // Google sends both forms, e.g.
  //   filename="ExampleSpreadsheet-ClassData.csv";
  //   filename*=UTF-8''Example%20Spreadsheet%20-%20Class%20Data.csv
  // RFC 6266 says the starred one wins, and it's also the one the user
  // recognizes — the unstarred fallback has the spaces stripped out.
  const encoded = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  const plain = header.match(/filename="?([^";]+)"?/i);
  let name = (encoded?.[1] ?? plain?.[1] ?? '').trim();
  if (encoded) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // Malformed escape — keep the raw value rather than losing the name.
    }
  }
  // Only ever used as a display label and a File name, never as a path, but
  // strip separators anyway so it can't start reading as one downstream.
  return name.replace(/[/\\]/g, '_').trim() || fallback;
}

/**
 * Read the body with a hard ceiling, so an oversized file is abandoned
 * mid-stream instead of being buffered in full and only then rejected.
 */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ImportLinkError(TOO_BIG_HINT);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchImportLink(raw: string): Promise<{ text: string; name: string }> {
  const url = resolveImportUrl(raw);

  // Redirects have to be followed: a Sheets export 307s off to a per-request
  // googleusercontent.com host that serves the actual bytes, and Drive
  // downloads do the same. That's why the allowlist gates the URL the *user*
  // supplies rather than the one we end up reading — the final host is
  // Google's to choose, and it's a different one every time.
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new ImportLinkError(
      res.status === 401 || res.status === 403 || res.status === 404
        ? SHARE_HINT
        : "Google couldn't serve that file. Try again in a moment."
    );
  }

  // A file that isn't link-shared answers with the sign-in page — HTTP 200 and
  // all — so the status alone can't tell us we got the file. The type can.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new ImportLinkError(SHARE_HINT);
  }

  if (Number(res.headers.get('content-length')) > MAX_BYTES) {
    throw new ImportLinkError(TOO_BIG_HINT);
  }

  const text = await readCapped(res);
  if (!text.trim()) throw new ImportLinkError('That file is empty.');

  return { text, name: filenameFrom(res.headers.get('content-disposition')) };
}

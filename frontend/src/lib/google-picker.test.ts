// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isNative = vi.fn(() => false);
vi.mock('./platform', () => ({ isNativePlatform: () => isNative() }));

/** Re-import with a chosen env, since the module reads import.meta.env at load. */
async function load(env: { key?: string; clientId?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_API_KEY', env.key ?? '');
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', env.clientId ?? '');
  return import('./google-picker');
}

const KEYED = { key: 'test-api-key', clientId: 'test-client.apps.googleusercontent.com' };

/** Stand in for the two Google globals the module loads over the network. */
function stubGoogle(
  opts: {
    token?: { access_token?: string; expires_in?: number; error?: string };
    tokenError?: { type?: string };
    /** ms after popup_closed that the token arrives — reproduces the race. */
    tokenAfterPopupClose?: number;
    /** Delay the token, as a real consent popup does — without this the whole
     *  flow resolves synchronously and concurrency can't be modelled. */
    tokenDelay?: number;
    docs?: { id: string; name: string; mimeType: string }[];
    cancel?: boolean;
  } = {}
) {
  const picked = opts.docs ?? [];
  let builtCallback: ((d: Record<string, unknown>) => void) | undefined;
  /** What the module actually asked Google for. */
  const seen: { appId?: string; tokenRequests: number; pickerShows: number } = {
    tokenRequests: 0,
    pickerShows: 0,
  };

  const chain = () => {
    const b: Record<string, unknown> = {};
    for (const m of [
      'setIncludeFolders',
      'setSelectFolderEnabled',
      'setMimeTypes',
      'setDeveloperKey',
      'setOAuthToken',
      'addView',
      'enableFeature',
      'setTitle',
      'build',
    ]) {
      b[m] = () => b;
    }
    b.setAppId = (id: string) => {
      seen.appId = id;
      return b;
    };
    b.setCallback = (cb: (d: Record<string, unknown>) => void) => {
      builtCallback = cb;
      return b;
    };
    b.setVisible = () => {
      seen.pickerShows++;
      builtCallback?.({
        action: opts.cancel ? 'cancel' : 'picked',
        docs: picked,
      });
    };
    return b;
  };

  (window as unknown as Record<string, unknown>).gapi = {
    load: (_n: string, cb: () => void) => cb(),
  };
  (window as unknown as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: {
          callback: (r: unknown) => void;
          error_callback?: (e: unknown) => void;
        }) => ({
          requestAccessToken: () => {
            seen.tokenRequests++;
            if (opts.tokenError) cfg.error_callback?.(opts.tokenError);
            // The race that broke this in production: the popup closing is
            // reported BEFORE the token that the same grant is about to
            // deliver. Both fire, in that order.
            if (opts.tokenAfterPopupClose) {
              setTimeout(
                () => cfg.callback({ access_token: 'tok', expires_in: 3600 }),
                opts.tokenAfterPopupClose
              );
              return;
            }
            if (!opts.tokenError) {
              const deliver = () =>
                cfg.callback(opts.token ?? { access_token: 'tok', expires_in: 3600 });
              if (opts.tokenDelay) setTimeout(deliver, opts.tokenDelay);
              else deliver();
            }
          },
        }),
      },
    },
    picker: {
      DocsView: function DocsView() {
        return chain();
      },
      PickerBuilder: function PickerBuilder() {
        return chain();
      },
      ViewId: { DOCS: 'docs' },
      Feature: { MULTISELECT_ENABLED: 'multi' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
  return seen;
}

beforeEach(() => {
  isNative.mockReturnValue(false);
  // The module appends <script> tags; resolve them immediately.
  vi.spyOn(document.head, 'appendChild').mockImplementation(((el: HTMLScriptElement) => {
    queueMicrotask(() => el.onload?.(new Event('load')));
    return el;
  }) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).gapi;
  delete (window as unknown as Record<string, unknown>).google;
});

describe('availability gating', () => {
  it('is off with no credentials', async () => {
    const m = await load();
    expect(m.googlePickerConfigured()).toBe(false);
    expect(m.googlePickerAvailable()).toBe(false);
  });

  it('is off when only one credential is present', async () => {
    const m = await load({ key: 'only-a-key' });
    expect(m.googlePickerConfigured()).toBe(false);
  });

  it('is off on native even when fully configured', async () => {
    // Google refuses OAuth in an embedded WebView, so the button must not
    // render there — this gate is what keeps the app from offering a dead one.
    isNative.mockReturnValue(true);
    const m = await load(KEYED);
    expect(m.googlePickerConfigured()).toBe(true);
    expect(m.googlePickerAvailable()).toBe(false);
  });

  it('is on for a keyed web build', async () => {
    const m = await load(KEYED);
    expect(m.googlePickerAvailable()).toBe(true);
  });

  it('resolves empty instead of throwing when unavailable', async () => {
    const m = await load();
    await expect(m.pickFromGoogleDrive()).resolves.toEqual([]);
  });
});

describe('picking', () => {
  it('downloads a picked CSV as a File', async () => {
    const m = await load(KEYED);
    stubGoogle({ docs: [{ id: 'f1', name: 'cards.csv', mimeType: 'text/csv' }] });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Name,Quantity\nSol Ring,1\n'));

    const [file] = await m.pickFromGoogleDrive();
    expect(file.name).toBe('cards.csv');
    expect(await file.text()).toContain('Sol Ring');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drive/v3/files/f1?alt=media');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('exports a Google Sheet to CSV and names it .csv', async () => {
    // A Sheet has no bytes of its own — fetching it with alt=media returns
    // nothing useful, so the export endpoint is the only correct path.
    const m = await load(KEYED);
    stubGoogle({
      docs: [
        { id: 's1', name: 'My Collection', mimeType: 'application/vnd.google-apps.spreadsheet' },
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Name\nForest\n'));

    const [file] = await m.pickFromGoogleDrive();
    expect(fetchSpy.mock.calls[0][0]).toContain('/export?mimeType=text%2Fcsv');
    expect(file.name).toBe('My Collection.csv');
  });

  it('does not double-suffix a Sheet already ending in .csv', async () => {
    const m = await load(KEYED);
    stubGoogle({
      docs: [{ id: 's1', name: 'list.csv', mimeType: 'application/vnd.google-apps.spreadsheet' }],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Name\nForest\n'));
    const [file] = await m.pickFromGoogleDrive();
    expect(file.name).toBe('list.csv');
  });

  it('returns every file when several are picked', async () => {
    const m = await load(KEYED);
    stubGoogle({
      docs: [
        { id: 'a', name: 'a.csv', mimeType: 'text/csv' },
        { id: 'b', name: 'b.csv', mimeType: 'text/csv' },
      ],
    });
    // A fresh Response per call — a body can only be read once, and both
    // downloads run concurrently off the same mock.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Name\nForest\n'));
    await expect(m.pickFromGoogleDrive()).resolves.toHaveLength(2);
  });

  it('reports cancelling the picker as CancelledError, not a silent empty result', async () => {
    const m = await load(KEYED);
    stubGoogle({ cancel: true });
    await expect(m.pickFromGoogleDrive()).rejects.toSatisfy(m.isCancelled);
  });

  it('reports a refused download against the file name', async () => {
    const m = await load(KEYED);
    stubGoogle({ docs: [{ id: 'f1', name: 'cards.csv', mimeType: 'text/csv' }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 403 }));
    await expect(m.pickFromGoogleDrive()).rejects.toThrow(/cards\.csv/);
  });

  it('refuses a file past the 5 MB ceiling', async () => {
    const m = await load(KEYED);
    stubGoogle({ docs: [{ id: 'f1', name: 'huge.csv', mimeType: 'text/csv' }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(5_000_001)));
    await expect(m.pickFromGoogleDrive()).rejects.toThrow(/too big/);
  });

  it('reports a genuinely dismissed consent popup as a cancellation', async () => {
    const m = await load(KEYED);
    stubGoogle({ tokenError: { type: 'popup_closed' } });
    await expect(m.pickFromGoogleDrive()).rejects.toSatisfy(m.isCancelled);
  });

  it('THE REGRESSION: a token arriving after popup_closed still opens the picker', async () => {
    // Google reports the consent window closing before delivering the token of
    // the grant that just succeeded. Treating popup_closed as an immediate
    // cancel aborted AFTER the user had authorised — they got signed in and
    // nothing opened, silently. The grace period must let the token win.
    const m = await load(KEYED);
    stubGoogle({
      tokenError: { type: 'popup_closed' },
      tokenAfterPopupClose: 200,
      docs: [{ id: 'f1', name: 'cards.csv', mimeType: 'text/csv' }],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Name\nForest\n'));

    const files = await m.pickFromGoogleDrive();
    expect(files.map((f) => f.name)).toEqual(['cards.csv']);
  });

  it('THE REGRESSION: two rapid clicks open exactly ONE consent popup', async () => {
    // The reported failure was "Opening multiple popups was blocked due to
    // lack of user activation" and nothing opening. A React busy flag can't
    // prevent it — setDriveBusy(true) is async, so two quick clicks both read
    // false and both start a flow. The second popup is then blocked. The guard
    // has to be synchronous, which is why it lives in the module.
    const m = await load(KEYED);
    const seen = stubGoogle({
      docs: [{ id: 'f1', name: 'a.csv', mimeType: 'text/csv' }],
      tokenDelay: 20,
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Name\nForest\n'));

    const [a, b] = await Promise.all([m.pickFromGoogleDrive(), m.pickFromGoogleDrive()]);
    expect(seen.tokenRequests).toBe(1);
    // Both callers still get the result — the second rides the first flow.
    expect(a.map((f) => f.name)).toEqual(['a.csv']);
    expect(b.map((f) => f.name)).toEqual(['a.csv']);
  });

  it('allows a fresh pick once the previous one has finished', async () => {
    // The in-flight guard must release, or the button works exactly once.
    const m = await load(KEYED);
    const seen = stubGoogle({ docs: [{ id: 'f1', name: 'a.csv', mimeType: 'text/csv' }] });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Name\nForest\n'));

    await m.pickFromGoogleDrive();
    await m.pickFromGoogleDrive();
    // The token is cached for an hour, so the second pick correctly skips
    // re-auth — what must happen twice is the PICKER opening.
    expect(seen.pickerShows).toBe(2);
    expect(seen.tokenRequests).toBe(1);
  });

  it('releases the in-flight guard after a failure too', async () => {
    const m = await load(KEYED);
    const seen = stubGoogle({ token: { error: 'access_denied' } });
    await expect(m.pickFromGoogleDrive()).rejects.toThrow();
    await expect(m.pickFromGoogleDrive()).rejects.toThrow();
    expect(seen.tokenRequests).toBe(2);
  });

  it('tells the user how to fix a browser-blocked popup', async () => {
    const m = await load(KEYED);
    stubGoogle({ tokenError: { type: 'popup_failed_to_open' } });
    await expect(m.pickFromGoogleDrive()).rejects.toThrow(/Allow pop-ups/i);
  });

  it('surfaces a real token failure', async () => {
    const m = await load(KEYED);
    stubGoogle({ token: { error: 'access_denied' } });
    await expect(m.pickFromGoogleDrive()).rejects.toThrow(/access_denied/);
  });

  it('names the failure type when Google errors for a non-popup reason', async () => {
    const m = await load(KEYED);
    stubGoogle({ tokenError: { type: 'unknown_error' } });
    await expect(m.pickFromGoogleDrive()).rejects.toThrow(/unknown_error/);
  });

  it('sets the app id, which drive.file needs to grant the picked file', async () => {
    // Without it the picker opens but the download 403s — the failure lands a
    // step later than the cause, so pin it here.
    const m = await load(KEYED);
    const seen = stubGoogle({ docs: [{ id: 'f1', name: 'a.csv', mimeType: 'text/csv' }] });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Name\nForest\n'));
    await m.pickFromGoogleDrive();
    // KEYED client id is "test-client.apps...", so the leading segment is "test".
    expect(seen.appId).toBe('test');
  });
});

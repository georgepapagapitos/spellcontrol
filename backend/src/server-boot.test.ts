/**
 * The server listens before Postgres is reachable (E1120).
 *
 * `start()` used to await the schema before `app.listen`, so a boot while the
 * database was unreachable took the whole site down: a refused connection
 * exited the process, and a host that accepted the connection and never
 * answered left it alive, never listening, with nothing logged. Both were
 * reproduced by hand before the fix.
 *
 * This boots the real `server.ts` in a child process, because the property is
 * about `start()`'s order and the gate wiring, which an app assembled in a test
 * would not exercise. Its Postgres is a TCP proxy that starts as a black hole
 * (accepts the connection, never answers: the harder of the two cases, since
 * only the pool's connect timeout ends an attempt) and later forwards to the
 * suite's database. The child gets its own `t_boot_*` schema through
 * `search_path`, so its `ensureSchema()` touches no other file's tables, and
 * the global setup's `t_*` sweep catches it if this file is killed mid-run.
 * The child exits when this worker does (it watches its stdin), and it binds
 * port 0 and reports the port it got, so there is no port to race for.
 *
 * Besides the boot order it covers what the gate must still let through or
 * answer differently while closed: sign-out (or the session cookie outlives a
 * sign-out on a shared device) and a browser navigation (a retrying page, not
 * raw JSON).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

interface Proxy {
  port: number;
  forward(): void;
  close(): Promise<void>;
}

/** A Postgres stand-in: black-holes every connection until `forward()`. */
function startProxy(target: { host: string; port: number }): Promise<Proxy> {
  let forwarding = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    if (!forwarding) return; // held open, never answered
    const upstream = net.connect(target.port, target.host);
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        forward: () => {
          forwarding = true;
        },
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const schema = `t_boot_${randomBytes(4).toString('hex')}`;
const workDir = mkdtempSync(path.join(tmpdir(), 'sc-boot-'));
const spaDir = path.join(workDir, 'public');
let admin: Pool;
let proxy: Proxy;
let child: ChildProcess;
let base = '';
let output = '';

function get(p: string): Promise<Response> {
  return fetch(`${base}${p}`, { signal: AbortSignal.timeout(5_000) });
}

beforeAll(async () => {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (vitest.global-setup.ts sets it)');
  admin = new Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);

  const target = new URL(testUrl);
  proxy = await startProxy({ host: target.hostname, port: Number(target.port || 5432) });
  const childUrl = new URL(testUrl);
  childUrl.hostname = '127.0.0.1';
  childUrl.port = String(proxy.port);
  childUrl.searchParams.set('options', `-c search_path=${schema}`);

  mkdirSync(path.join(spaDir, 'assets'), { recursive: true });
  writeFileSync(path.join(spaDir, 'index.html'), '<!doctype html><title>boot shell</title>');
  writeFileSync(path.join(spaDir, 'assets', 'app-test.js'), 'console.log("boot asset");');

  const backendDir = path.join(__dirname, '..');
  // The child exits when its stdin closes, which happens when this worker dies
  // however it dies, so a killed test run cannot leave a server behind. The
  // wrapper lives here, not in server.ts: production has no such path.
  const watchdog = `process.stdin.on('close', () => process.exit(1)); process.stdin.resume();`;
  const entry = `${watchdog} require(${JSON.stringify(path.join(__dirname, 'server.ts'))});`;
  child = spawn(process.execPath, ['--import', 'tsx', '--eval', entry], {
    cwd: backendDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      // The OS picks the port and the server logs the one it bound, so there is
      // no window between finding a free port and the child taking it.
      PORT: '0',
      DATABASE_URL: childUrl.toString(),
      PG_CONNECT_TIMEOUT_MS: '3000',
      SPA_DIR: spaDir,
      DB_PATH: path.join(workDir, 'cache.db'),
      JWT_SECRET: 'boot-test-secret-boot-test',
      // Nothing deferred runs inside this test's lifetime.
      BOOT_DEFER_MS: '3600000',
      SCANNER_PRELOAD_DISABLED: '1',
      SCRYFALL_BULK_INGEST_DISABLED: '1',
      COMBOS_INGEST_DISABLED: '1',
      AGGREGATES_ROLLUP_DISABLED: '1',
      PRECON_SEED_DISABLED: '1',
      RETENTION_DISABLED: '1',
      UPTIME_HEARTBEAT_DISABLED: '1',
    },
  });
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));

  try {
    const port = await waitFor(
      'the server to listen',
      async () => /\[server\] listening on http:\/\/localhost:(\d+)/.exec(output)?.[1],
      45_000
    );
    base = `http://127.0.0.1:${port}`;
  } catch (err) {
    throw new Error(`${(err as Error).message}; exit=${child.exitCode}; output:\n${output}`, {
      cause: err,
    });
  }
}, 60_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await proxy?.close();
  await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await admin?.end();
  rmSync(workDir, { recursive: true, force: true });
}, 20_000);

describe('server boot with Postgres unreachable (E1120)', () => {
  it('answers /health, static files and the SPA shell before the database answers', async () => {
    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, dbReady: false });

    const asset = await get('/assets/app-test.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('boot asset');

    const shell = await get('/');
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('boot shell');

    // A share landing reads Postgres for its meta; it serves the bare shell at
    // once rather than waiting out the 3 s connect timeout.
    const started = Date.now();
    const landing = await get('/d/some-deck');
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain('boot shell');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('answers 503 with Retry-After on routes that need the database', async () => {
    const res = await get('/api/auth/me');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const body = (await res.json()) as { error?: unknown; requestId?: unknown };
    expect(typeof body.error).toBe('string');
    expect(body.requestId).toBe(res.headers.get('x-request-id'));

    // The browser falls back to EDHREC directly on this header.
    const page = await get('/api/edhrec/page/pages/commanders/atraxa-praetors-voice.json');
    expect(page.status).toBe(503);
    expect(page.headers.get('x-edhrec-cache')).toBe('unavailable');

    expect((await get('/sitemap.xml')).status).toBe(503);
  });

  it('serves a browser navigation to a closed route a page that retries, not JSON', async () => {
    const res = await fetch(`${base}/api/auth/google/callback?code=x&state=y`, {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('http-equiv="refresh"');
  });

  it('signs out while the database is down: the session cookie is cleared, not left behind', async () => {
    const res = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: 'spellcontrol_session=stale-token' },
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(200);
    const cleared = res.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(/^spellcontrol_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('opens the database routes once Postgres answers, without a restart', async () => {
    proxy.forward();
    try {
      await waitFor(
        'the schema to be ready',
        async () => {
          const body = (await (await get('/health')).json()) as { dbReady?: boolean };
          return body.dbReady ? true : undefined;
        },
        30_000
      );
    } catch (err) {
      throw new Error(`${(err as Error).message}; output:\n${output}`, { cause: err });
    }
    // No cookie: the route itself answers now, not the gate.
    expect((await get('/api/auth/me')).status).toBe(401);
    // Same process the whole way: it never exited to be restarted.
    expect(child.exitCode).toBeNull();
    // The schema went into this file's own schema and nowhere else.
    const tables = await admin.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'users'`,
      [schema]
    );
    expect(tables.rows[0].n).toBe(1);
  }, 45_000);
});

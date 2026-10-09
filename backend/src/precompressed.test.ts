import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { precompressed } from './precompressed';

let root: string;
let server: Server;

const CSS = 'body{color:red}'.repeat(50);
const JSON_BODY = JSON.stringify({ tags: { ramp: ['Sol Ring'] } });

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'precompressed-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'assets', 'index-abc.css'), CSS);
  writeFileSync(path.join(root, 'assets', 'index-abc.css.br'), brotliCompressSync(CSS));
  writeFileSync(path.join(root, 'assets', 'index-abc.css.gz'), gzipSync(CSS));
  writeFileSync(path.join(root, 'tags.json'), JSON_BODY);
  writeFileSync(path.join(root, 'tags.json.gz'), gzipSync(JSON_BODY));
  writeFileSync(path.join(root, 'plain.js'), 'console.log(1)');
  const app = express();
  app.use(precompressed(root));
  app.use(express.static(root));
  // Loopback bind + a listening server, never a bare app (see
  // project_supertest_wildcard_port_collision).
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe('precompressed', () => {
  it('serves the .br sibling as brotli with the original content type', async () => {
    const res = await request(server)
      .get('/assets/index-abc.css')
      .set('Accept-Encoding', 'gzip, deflate, br');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-type']).toMatch(/^text\/css/);
    expect(res.headers.vary).toBe('Accept-Encoding');
    expect(res.text).toBe(CSS);
  });

  it('falls back to .gz when brotli is not accepted or not on disk', async () => {
    const gzOnly = await request(server)
      .get('/assets/index-abc.css')
      .set('Accept-Encoding', 'gzip');
    expect(gzOnly.headers['content-encoding']).toBe('gzip');
    expect(gzOnly.text).toBe(CSS);
    const noBr = await request(server).get('/tags.json').set('Accept-Encoding', 'br, gzip');
    expect(noBr.headers['content-encoding']).toBe('gzip');
    expect(noBr.headers['content-type']).toMatch(/^application\/json/);
    expect(noBr.body).toEqual(JSON.parse(JSON_BODY));
  });

  it('serves the plain file when nothing is accepted or nothing is pre-compressed', async () => {
    const identity = await request(server)
      .get('/assets/index-abc.css')
      .set('Accept-Encoding', 'identity');
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.text).toBe(CSS);
    const plain = await request(server).get('/plain.js').set('Accept-Encoding', 'br, gzip');
    expect(plain.status).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.text).toBe('console.log(1)');
  });

  it('never rewrites a traversal attempt or a non-GET', () => {
    // Called directly: every HTTP client normalizes `..` (and `%2e%2e`) away
    // before the request leaves, so the guard can only be exercised in-process.
    const handler = precompressed(root);
    for (const [method, url] of [
      ['GET', '/assets/../assets/index-abc.css'],
      ['GET', '/assets/%2e%2e/assets/index-abc.css'],
      ['POST', '/assets/index-abc.css'],
    ]) {
      const req = {
        method,
        url,
        path: url,
        headers: { 'accept-encoding': 'br, gzip' },
      } as unknown as express.Request;
      const set: Record<string, string> = {};
      const res = {
        setHeader: (k: string, v: string) => {
          set[k] = v;
        },
        type: () => res,
      } as unknown as express.Response;
      let nexts = 0;
      handler(req, res, () => nexts++);
      expect(nexts).toBe(1);
      expect(req.url).toBe(url);
      expect(set).toEqual({});
    }
  });
});

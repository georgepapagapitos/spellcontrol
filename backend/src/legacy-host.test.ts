import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { redirectLegacyApiHost } from './legacy-host';

// Mirrors server.ts's order: api routes, then the host check, then the SPA.
function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/api/ping', (_req, res) => void res.json({ ok: true }));
  app.get('/health', (_req, res) => void res.send('ok'));
  app.get('/.well-known/x', (_req, res) => void res.send('wk'));
  app.use(redirectLegacyApiHost);
  app.use((_req, res) => void res.send('<html>spa</html>'));
  return app;
}

describe('redirectLegacyApiHost', () => {
  const api = 'api.spellcontrol.com';

  it('301s pages on the api host to the apex, keeping path and query', async () => {
    const res = await request(makeApp()).get('/decks?x=1').set('Host', api);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://spellcontrol.com/decks?x=1');
  });

  it('301s HEAD and asset paths too', async () => {
    const res = await request(makeApp()).head('/assets/a.js').set('Host', api);
    expect(res.status).toBe(301);
  });

  it('leaves /api, /health and /.well-known alone on the api host', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/ping').set('Host', api)).body).toEqual({ ok: true });
    expect((await request(app).get('/health').set('Host', api)).status).toBe(200);
    expect((await request(app).get('/.well-known/x').set('Host', api)).text).toBe('wk');
  });

  it('does not redirect non-GET methods', async () => {
    const res = await request(makeApp()).post('/decks').set('Host', api);
    expect(res.status).not.toBe(301);
  });

  it('still serves the SPA on the apex and on local hosts', async () => {
    const app = makeApp();
    for (const host of ['spellcontrol.com', 'localhost:3737']) {
      const res = await request(app).get('/decks').set('Host', host);
      expect(res.status).toBe(200);
      expect(res.text).toContain('spa');
    }
  });

  it('is mounted in server.ts ahead of the share landings and the static layer', () => {
    const src = readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
    const mount = src.indexOf('app.use(redirectLegacyApiHost)');
    expect(mount).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(src.indexOf("app.get('/s/:token'"));
    expect(mount).toBeLessThan(src.indexOf('express.static(SPA_DIR'));
  });
});

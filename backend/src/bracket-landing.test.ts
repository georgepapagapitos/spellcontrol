import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAME_CHANGERS_AS_OF, HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { BRACKET_PATH, bracketLandingMeta } from './bracket-landing';
import { createStaticLandingHandler } from './shares/og';
import { isSpaRoute } from './spa-routes';
import { STATIC_URLS } from './sitemap';

describe('public bracket checker landing (E1090)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bracket-shell-'));
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<html><head><title>SpellControl</title><meta name="description" content="home" /></head><body><div id="root"></div></body></html>'
  );
  const server = createServer(
    express().get(BRACKET_PATH, createStaticLandingHandler(dir, bracketLandingMeta()))
  );
  beforeAll(() => new Promise<void>((r) => server.listen(0, '127.0.0.1', r)));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves an indexable page with its own title, description and canonical', async () => {
    const res = await request(server).get('/bracket');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Commander bracket checker');
    expect(res.text).toContain('rel="canonical" href="https://spellcontrol.com/bracket"');
    expect(res.text).not.toContain('noindex');
    expect(res.text).not.toContain('content="home"');
  });

  it('puts the Game Changers list and its as-of date in the HTML a crawler fetches', async () => {
    const res = await request(server).get('/bracket');
    expect(res.text).toContain('<h1>Commander bracket checker</h1>');
    for (const name of HARDCODED_GAME_CHANGERS) {
      expect(res.text, name).toContain(`<li>${name.replace(/'/g, '&#39;')}</li>`);
    }
    expect(GAME_CHANGERS_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.text).toContain('Last checked against the Rules Committee');
  });

  it('is a SPA route and in the sitemap', () => {
    expect(isSpaRoute(BRACKET_PATH)).toBe(true);
    expect(STATIC_URLS.map((u) => u.path)).toContain(BRACKET_PATH);
  });
});

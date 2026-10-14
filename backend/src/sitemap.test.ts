import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_URLS, buildSitemapXml } from './sitemap';

describe('buildSitemapXml', () => {
  it('emits every static page and escapes dynamic paths', () => {
    const xml = buildSitemapXml([
      ...STATIC_URLS,
      { path: '/d/a&b', lastmod: Date.UTC(2026, 8, 7, 12), priority: 0.7 },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<loc>https://spellcontrol.com/</loc>');
    expect(xml).toContain('<loc>https://spellcontrol.com/guides/import-moxfield.html</loc>');
    expect(xml).toContain('<loc>https://spellcontrol.com/d/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-09-07</lastmod>');
    expect(xml).toContain('<priority>0.7</priority>');
    expect((xml.match(/<url>/g) ?? []).length).toBe(STATIC_URLS.length + 1);
  });
});

describe('static guides', () => {
  const dir = join(__dirname, '../../frontend/public/guides');
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'index.html');

  it('lists every guide page in the sitemap', () => {
    const listed = new Set(STATIC_URLS.map((u) => u.path));
    for (const page of pages) expect(listed, page).toContain(`/guides/${page}`);
  });

  it('links every guide page from the guides index', () => {
    const index = readFileSync(join(dir, 'index.html'), 'utf8');
    for (const page of pages) {
      expect(index, page).toContain(`href="/guides/${page}"`);
    }
  });
});

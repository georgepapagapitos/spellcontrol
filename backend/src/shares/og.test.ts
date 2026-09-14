import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import {
  buildShareHeadTags,
  cardArtUrl,
  createShareLandingHandler,
  escapeHtmlAttr,
  injectShareHead,
} from './og';

describe('createShareLandingHandler status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-shell-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
  const server = createServer(
    express()
      .get(
        '/d/:token',
        createShareLandingHandler(dir, async (t) =>
          t === 'live' ? { title: 'x', description: 'y', url: 'u', indexable: true } : null
        )
      )
      .get(
        '/err/:token',
        createShareLandingHandler(dir, async () => {
          throw new Error('db down');
        })
      )
  );
  beforeAll(() => new Promise<void>((r) => server.listen(0, '127.0.0.1', r)));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves 200 + canonical for a live page', async () => {
    const res = await request(server).get('/d/live');
    expect(res.status).toBe(200);
    expect(res.text).toContain('rel="canonical"');
  });
  it('serves a real 404 (still the SPA shell, noindex) for a definite miss', async () => {
    const res = await request(server).get('/d/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('noindex,nofollow');
    expect(res.text).toContain('<body>');
  });
  it('keeps 200 when the lookup itself errors', async () => {
    const res = await request(server).get('/err/x');
    expect(res.status).toBe(200);
    expect(res.text).toContain('noindex,nofollow');
  });
});

describe('escapeHtmlAttr', () => {
  it('escapes all HTML-sensitive characters', () => {
    expect(escapeHtmlAttr(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('escapes & before other chars to avoid double-encoding', () => {
    expect(escapeHtmlAttr('&amp;')).toBe('&amp;amp;');
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtmlAttr('George — Lands Matter')).toBe('George — Lands Matter');
  });
});

describe('buildShareHeadTags', () => {
  it('emits robots noindex even when no share metadata is available', () => {
    const out = buildShareHeadTags(null);
    expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
    expect(out).not.toContain('og:');
    expect(out).not.toContain('twitter:');
  });

  it('emits OG + Twitter tags for a real share', () => {
    const out = buildShareHeadTags({
      title: 'Lands Matter — shared by george',
      description: 'A Commander deck shared by george on SpellControl.',
      url: 'https://spellcontrol.com/s/abc123',
    });
    expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
    expect(out).toContain('<meta property="og:type" content="website"');
    expect(out).toContain('<meta property="og:site_name" content="SpellControl"');
    expect(out).toContain('<meta property="og:title" content="Lands Matter — shared by george"');
    expect(out).toContain(
      '<meta property="og:description" content="A Commander deck shared by george on SpellControl."'
    );
    expect(out).toContain('<meta property="og:url" content="https://spellcontrol.com/s/abc123"');
    expect(out).toContain('<meta name="twitter:card" content="summary"');
    expect(out).toContain('<meta name="twitter:title" content="Lands Matter — shared by george"');
  });

  it('escapes user-supplied content so it cannot break out of attributes', () => {
    const out = buildShareHeadTags({
      title: `"><script>alert('xss')</script>`,
      description: `O'Brien & sons`,
      url: 'https://spellcontrol.com/s/x',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
    expect(out).toContain('O&#39;Brien &amp; sons');
  });

  it('uses meta.image for og:image and twitter:image when present, escaped', () => {
    const out = buildShareHeadTags({
      title: 'Atraxa Superfriends — shared by george',
      description: 'A Commander deck shared by george on SpellControl.',
      url: 'https://spellcontrol.com/s/abc123',
      image: 'https://cards.scryfall.io/art_crop/atraxa.jpg?a=1&b=2',
    });
    expect(out).toContain(
      '<meta property="og:image" content="https://cards.scryfall.io/art_crop/atraxa.jpg?a=1&amp;b=2"'
    );
    expect(out).toContain(
      '<meta name="twitter:image" content="https://cards.scryfall.io/art_crop/atraxa.jpg?a=1&amp;b=2"'
    );
  });

  it('falls back to the static OG image when meta.image is omitted', () => {
    const out = buildShareHeadTags({
      title: 'Some collection',
      description: 'Desc',
      url: 'https://spellcontrol.com/s/x',
    });
    expect(out).toContain(
      '<meta property="og:image" content="https://spellcontrol.com/og-image.png"'
    );
    expect(out).toContain(
      '<meta name="twitter:image" content="https://spellcontrol.com/og-image.png"'
    );
  });

  it('emits an escaped og:image:alt reusing the title', () => {
    const out = buildShareHeadTags({
      title: `O'Brien's deck`,
      description: 'Desc',
      url: 'https://spellcontrol.com/s/x',
    });
    expect(out).toContain('<meta property="og:image:alt" content="O&#39;Brien&#39;s deck"');
  });

  it('omits noindex and includes an escaped canonical link when indexable', () => {
    const out = buildShareHeadTags({
      title: 'Lands Matter — commander deck',
      description: '99 cards — view on SpellControl.',
      url: 'https://spellcontrol.com/d/lands-matter?ref=x&y=1',
      indexable: true,
    });
    expect(out).not.toContain('noindex');
    expect(out).toContain(
      '<link rel="canonical" href="https://spellcontrol.com/d/lands-matter?ref=x&amp;y=1" />'
    );
    // OG/Twitter tags are still emitted for an indexable page.
    expect(out).toContain('<meta property="og:title"');
  });

  it('keeps noindex-always behavior byte-identical when indexable is absent', () => {
    const meta = {
      title: 'Lands Matter — shared by george',
      description: 'A Commander deck shared by george on SpellControl.',
      url: 'https://spellcontrol.com/s/abc123',
    };
    expect(buildShareHeadTags(meta)).toBe(buildShareHeadTags({ ...meta, indexable: false }));
    const out = buildShareHeadTags(meta);
    expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
    expect(out).not.toContain('canonical');
  });
});

describe('cardArtUrl', () => {
  it('reads the direct image_uris.art_crop field', () => {
    const url = cardArtUrl({
      image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/a.jpg' },
    });
    expect(url).toBe('https://cards.scryfall.io/art_crop/a.jpg');
  });

  it('falls back to card_faces[0].image_uris.art_crop for double-faced cards', () => {
    const url = cardArtUrl({
      card_faces: [{ image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front.jpg' } }],
    });
    expect(url).toBe('https://cards.scryfall.io/art_crop/front.jpg');
  });

  it('prefers the direct field over card_faces when both are present', () => {
    const url = cardArtUrl({
      image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/direct.jpg' },
      card_faces: [{ image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front.jpg' } }],
    });
    expect(url).toBe('https://cards.scryfall.io/art_crop/direct.jpg');
  });

  it('returns undefined (never throws) when neither shape yields an image', () => {
    expect(cardArtUrl({ name: 'No Art Card' })).toBeUndefined();
    expect(cardArtUrl(null)).toBeUndefined();
    expect(cardArtUrl(undefined)).toBeUndefined();
    expect(cardArtUrl('not an object')).toBeUndefined();
  });
});

describe('injectShareHead', () => {
  const shell = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>SpellControl</title>
  </head>
  <body><div id="root"></div></body>
</html>
`;

  it('splices the meta block before </head>', () => {
    const out = injectShareHead(shell, {
      title: 'Deck',
      description: 'Desc',
      url: 'https://spellcontrol.com/s/t',
    });
    const headerEnd = out.indexOf('</head>');
    const ogIdx = out.indexOf('og:title');
    expect(ogIdx).toBeGreaterThan(0);
    expect(ogIdx).toBeLessThan(headerEnd);
    // The document title is now the share's own — a search result's headline
    // comes from <title>, never from og:title.
    expect(out).toContain('<title>Deck</title>');
    expect(out).not.toContain('<title>SpellControl</title>');
  });

  it('still injects noindex for unknown shares, and leaves the shell alone', () => {
    const out = injectShareHead(shell, null);
    expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
    expect(out).not.toContain('og:title');
    // Nothing better to describe the page with, so the shell's own card stays.
    expect(out).toContain('<title>SpellControl</title>');
  });

  // E309. The shell carries a static homepage card (canonical + a full og:/
  // twitter: set) because an SPA can't vary those per route. Appending ours
  // after it left BOTH on the page: Google discards conflicting canonicals, so
  // public deck pages never ranked as themselves, and share previews took
  // whichever og:title their consumer happened to pick first.
  describe('shell homepage tags are replaced, not duplicated', () => {
    const richShell = `<!doctype html>
<html>
  <head>
    <title>SpellControl — Organize MTG binders</title>
    <meta name="description" content="Site description stays." />
    <link rel="canonical" href="https://spellcontrol.com/" />
    <meta property="og:title" content="SpellControl" />
    <meta
      property="og:description"
      content="Homepage card."
    />
    <meta property="og:image" content="https://spellcontrol.com/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="SpellControl" />
  </head>
  <body></body>
</html>
`;
    const deck = {
      title: 'atraxa — commander deck',
      description: '100 cards',
      url: 'https://spellcontrol.com/d/atraxa-6007356a',
      indexable: true,
    };

    const count = (h: string, needle: string) => h.split(needle).length - 1;

    it('leaves exactly one canonical, and it is the page itself', () => {
      const out = injectShareHead(richShell, deck);
      expect(count(out, 'rel="canonical"')).toBe(1);
      expect(out).toContain(`<link rel="canonical" href="${deck.url}" />`);
      expect(out).not.toContain('href="https://spellcontrol.com/" />');
    });

    it('leaves exactly one of each social tag, describing the deck', () => {
      const out = injectShareHead(richShell, deck);
      expect(count(out, 'property="og:title"')).toBe(1);
      expect(count(out, 'property="og:description"')).toBe(1);
      expect(count(out, 'property="og:image"')).toBe(1);
      expect(count(out, 'name="twitter:card"')).toBe(1);
      expect(count(out, 'name="twitter:title"')).toBe(1);
      expect(out).toContain(`content="${deck.title}"`);
      expect(out).not.toContain('content="Homepage card."');
    });

    it('rewrites the document title and keeps the non-social description', () => {
      const out = injectShareHead(richShell, deck);
      expect(out).toContain(`<title>${deck.title}</title>`);
      expect(count(out, '<title>')).toBe(1);
      // Only og:/twitter:/canonical are shell-owned; a plain meta description
      // is not ours to remove.
      expect(out).toContain('content="Site description stays."');
    });

    it('strips for a non-indexable share too — a preview is not a ranking surface', () => {
      const out = injectShareHead(richShell, { ...deck, indexable: false });
      expect(count(out, 'property="og:title"')).toBe(1);
      expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
      // noindex, so no canonical at all rather than a contradictory one.
      expect(count(out, 'rel="canonical"')).toBe(0);
    });

    // The regex has to survive the REAL shell's multi-line attribute
    // formatting, which a hand-written fixture would not catch drifting.
    it('handles the real frontend/index.html', () => {
      const real = path.join(__dirname, '..', '..', '..', 'frontend', 'index.html');
      const html = fs.readFileSync(real, 'utf8');
      expect(count(html, 'rel="canonical"')).toBe(1); // the shell's own
      const out = injectShareHead(html, deck);
      expect(count(out, 'rel="canonical"')).toBe(1);
      expect(out).toContain(`<link rel="canonical" href="${deck.url}" />`);
      expect(count(out, 'property="og:title"')).toBe(1);
      expect(count(out, 'name="twitter:title"')).toBe(1);
      expect(out).toContain(`<title>${deck.title}</title>`);
    });
  });

  it('falls back to the original HTML when the template has no </head>', () => {
    const broken = '<html><body>just a body</body></html>';
    expect(injectShareHead(broken, null)).toBe(broken);
  });

  it('only splices at the last </head> (handles weirdly nested templates)', () => {
    // Contrived: a templated shell that mentions </head> in a comment.
    const tricky = `<!-- looks like </head> but isn't --><html><head><title>x</title></head><body></body></html>`;
    const out = injectShareHead(tricky, null);
    // The injection point should be the real </head>, so the comment stays intact
    // and the injected meta lands inside the real <head>.
    const realHeadEnd = out.lastIndexOf('</head>');
    const robotsIdx = out.indexOf('name="robots"');
    expect(robotsIdx).toBeGreaterThan(0);
    expect(robotsIdx).toBeLessThan(realHeadEnd);
    expect(out).toContain("<!-- looks like </head> but isn't -->");
  });
});

import { describe, expect, it } from 'vitest';
import { buildShareHeadTags, escapeHtmlAttr, injectShareHead } from './og';

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
    // The original title tag must still be present (we add to the head, not replace it).
    expect(out).toContain('<title>SpellControl</title>');
  });

  it('still injects noindex for unknown shares', () => {
    const out = injectShareHead(shell, null);
    expect(out).toContain('<meta name="robots" content="noindex,nofollow"');
    expect(out).not.toContain('og:title');
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

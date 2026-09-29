import { describe, it, expect } from 'vitest';
import { renderMarkdownLite } from './markdown-lite';

describe('renderMarkdownLite', () => {
  it('returns empty output for an empty (or whitespace-only) string', () => {
    expect(renderMarkdownLite('')).toBe('');
    expect(renderMarkdownLite('   \n  \n\t')).toBe('');
  });

  it('renders bold', () => {
    expect(renderMarkdownLite('**strong text**')).toBe('<p><strong>strong text</strong></p>');
  });

  it('renders italic', () => {
    expect(renderMarkdownLite('*italic text*')).toBe('<p><em>italic text</em></p>');
  });

  it('renders bold and italic together in one paragraph', () => {
    expect(renderMarkdownLite('**bold** and *italic*')).toBe(
      '<p><strong>bold</strong> and <em>italic</em></p>'
    );
  });

  it('splits blank-line-separated blocks into separate paragraphs', () => {
    expect(renderMarkdownLite('First paragraph.\n\nSecond paragraph.')).toBe(
      '<p>First paragraph.</p><p>Second paragraph.</p>'
    );
  });

  it('joins single newlines within one paragraph with a space', () => {
    expect(renderMarkdownLite('Line one\nline two')).toBe('<p>Line one line two</p>');
  });

  it('renders a `- ` block as a list', () => {
    expect(renderMarkdownLite('- first\n- second\n- third')).toBe(
      '<ul><li>first</li><li>second</li><li>third</li></ul>'
    );
  });

  it('renders a list alongside paragraphs', () => {
    expect(renderMarkdownLite('Intro line.\n\n- one\n- two\n\nOutro line.')).toBe(
      '<p>Intro line.</p><ul><li>one</li><li>two</li></ul><p>Outro line.</p>'
    );
  });

  it('never lets a script tag survive — renders it as literal escaped text', () => {
    const out = renderMarkdownLite('<script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes other HTML-significant characters (attributes, quotes, ampersands)', () => {
    const out = renderMarkdownLite('<img src=x onerror="alert(1)"> Tom & Jerry\'s');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(out).toContain('Tom &amp; Jerry&#39;s');
  });

  it('renders unterminated bold markers as literal asterisks instead of throwing or eating the rest', () => {
    expect(() => renderMarkdownLite('**bold and no closing marker')).not.toThrow();
    const out = renderMarkdownLite('**bold and no closing marker');
    expect(out).toBe('<p>**bold and no closing marker</p>');
  });

  it('renders an unterminated marker before a later paragraph without swallowing it', () => {
    const out = renderMarkdownLite('**oops\n\nSecond paragraph stays intact.');
    expect(out).toBe('<p>**oops</p><p>Second paragraph stays intact.</p>');
  });

  it('only emits the five allowed tags — p, strong, em, ul, li', () => {
    const out = renderMarkdownLite('**bold**\n\n- a\n- b\n\n*italic*');
    const tags = new Set(Array.from(out.matchAll(/<\/?(\w+)/g)).map((m) => m[1]));
    expect(tags).toEqual(new Set(['p', 'strong', 'ul', 'li', 'em']));
  });
});

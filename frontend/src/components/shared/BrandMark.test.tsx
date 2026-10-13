// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

// The component and public/favicon.svg draw the same mark. Compare shapes so
// a one-sided edit fails here instead of shipping a tab icon that disagrees
// with the header.
const shapes = (markup: string) =>
  [...markup.matchAll(/<(rect|circle)\b([^>]*?)\/?>/g)].map(
    ([, tag, attrs]) =>
      tag +
      [...attrs.matchAll(/(\w+)="([^"]*)"/g)]
        .filter(([, k]) =>
          ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'opacity'].includes(k)
        )
        .map(([, k, v]) => `${k}=${v}`)
        .sort()
        .join(',')
  );

describe('BrandMark', () => {
  const html = renderToStaticMarkup(<BrandMark />);

  it('is decorative and follows the surrounding colour', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('draws the same shapes as the favicon', () => {
    const favicon = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
    expect(shapes(favicon)).toEqual(shapes(html));
  });
});

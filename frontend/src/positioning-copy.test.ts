// @vitest-environment node
/**
 * Positioning guard (E1089, E265 O5/O17). The lead line is "scan or import your
 * collection, and it files itself into your binders", and it has to stay on the
 * five surfaces the market research named. The "no third-party trackers" claim
 * is only allowed while it is true, so this also fails if index.html or a
 * static guide starts loading a script or stylesheet from another origin.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const LEAD = /files\s+itself\s+into\s+your\s+binders/i;

describe('positioning copy', () => {
  it.each([
    ['welcome hero', 'src/components/welcome/WelcomeHero.tsx'],
    ['meta description', 'index.html'],
    ['organize guide intro', 'public/guides/organize-your-binder.html'],
    ['guides index', 'public/guides/index.html'],
    ['scan queue empty hint', 'src/components/scanner/ScannerQueueSheet.tsx'],
    ['import-manabox guide', 'public/guides/import-manabox.html'],
    ['switch-from-manabox guide', 'public/guides/switch-from-manabox.html'],
  ])('leads with the filing line: %s', (_name, file) => {
    expect(read(file)).toMatch(LEAD);
  });

  it('says the app is free with no ads and no third-party trackers on the hero', () => {
    expect(read('src/components/welcome/WelcomeHero.tsx')).toMatch(
      /Free, no ads, no third-party trackers/
    );
  });

  it('links the ManaBox switcher guide from the welcome footer and the import panel', () => {
    expect(read('src/pages/WelcomePage.tsx')).toContain('/guides/switch-from-manabox.html');
    expect(read('src/components/import/UploadPanel.tsx')).toContain(
      '/guides/switch-from-manabox.html'
    );
  });

  it('the switcher guide has its own title, description, canonical and og tags', () => {
    const html = read('public/guides/switch-from-manabox.html');
    expect(html).toMatch(/<title>Switch from ManaBox to SpellControl<\/title>/);
    expect(html).toMatch(/name="description"\s+content="[^"]{60,}"/);
    expect(html).toContain('href="https://spellcontrol.com/guides/switch-from-manabox.html"');
    expect(html).toContain(
      'property="og:url" content="https://spellcontrol.com/guides/switch-from-manabox.html"'
    );
  });
});

describe('no third-party trackers', () => {
  const pages = [
    'index.html',
    ...['index', 'compare', 'organize-your-binder', 'import-manabox', 'switch-from-manabox'].map(
      (n) => `public/guides/${n}.html`
    ),
  ];
  it.each(pages)('%s loads no script or stylesheet from another origin', (file) => {
    const html = read(file);
    const external = [
      ...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(https?:)?\/\/[^"]+"[^>]*>/g),
    ]
      .map((m) => m[0])
      // canonical, og:url and similar point at ourselves or are not loads
      .filter((tag) => !/rel="canonical"/.test(tag));
    expect(external).toEqual([]);
  });
});

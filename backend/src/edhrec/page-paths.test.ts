import { describe, expect, it } from 'vitest';
import { edhrecPageUrl } from './page-paths';

describe('edhrecPageUrl', () => {
  it('puts an allowlisted path on the fixed host', () => {
    const url = new URL(edhrecPageUrl('/pages/commanders/sythis-harvests-hand.json'));
    expect(url.origin).toBe('https://json.edhrec.com');
    expect(url.pathname).toBe('/pages/commanders/sythis-harvests-hand.json');
  });

  it('refuses anything the allowlist did not produce', () => {
    for (const bad of [
      '@evil.example/pages/cards/x.json',
      ':8080/pages/cards/x.json',
      '//evil.example/pages/cards/x.json',
      '/pages/cards/x.json?u=1',
      '/pages/cards/../x.json',
      'pages/cards/x.json',
    ]) {
      expect(() => edhrecPageUrl(bad), bad).toThrow('not an allowlisted EDHREC page');
    }
  });
});

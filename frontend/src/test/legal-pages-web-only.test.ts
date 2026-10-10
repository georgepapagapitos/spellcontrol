// @vitest-environment node
/**
 * Guard: the static legal pages (`public/privacy.html`, `public/terms.html`)
 * describe the product that ships, and the web is the only target since the
 * Android app was removed in #2102. The privacy policy went on telling readers
 * about "the mobile app" and "uninstalling the mobile app" for weeks after.
 *
 * Fix a failure by rewriting the sentence for the browser, never by adding an
 * exception here. If a native app ever ships again, delete this test with it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
const PAGES = ['privacy.html', 'terms.html'];
const NATIVE = /mobile app|android|play store|app store|uninstall/i;

describe('legal pages describe the web app only', () => {
  it.each(PAGES)('%s names no native app', (page) => {
    const text = readFileSync(resolve(publicDir, page), 'utf8');
    const hits = text.split('\n').filter((line) => NATIVE.test(line));
    expect(hits).toEqual([]);
  });
});

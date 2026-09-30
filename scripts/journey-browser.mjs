// Browser setup shared by the nightly journey (journey.mjs) and the component
// catalog shots (catalog-shots.mjs): the two viewport tiers and the binary
// lookup. JOURNEY_CHROME / JOURNEY_FIREFOX override the defaults.
import { existsSync } from 'node:fs';

export const TIERS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

export function executable(browser) {
  const env = browser === 'firefox' ? process.env.JOURNEY_FIREFOX : process.env.JOURNEY_CHROME;
  if (env) return env;
  const candidates =
    browser === 'firefox'
      ? [
          '/Applications/Firefox.app/Contents/MacOS/firefox',
          '/usr/bin/firefox',
          '/snap/bin/firefox',
        ]
      : [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
        ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`no ${browser} binary found; set JOURNEY_${browser.toUpperCase()}`);
  return found;
}

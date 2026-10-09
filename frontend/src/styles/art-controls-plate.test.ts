/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard: the Like/Bookmark buttons and the Open pill on a grid deck tile sit
// on the scrim plate at rest (STYLE_GUIDE § On-art scrims). They used to be a
// bare white glyph with a drop-shadow, which vanished wherever the cover is a
// full card image: on the precons shelf the heart and bookmark landed on the
// pale name bar and the mana cost and could not be found.
//
// Read off disk: CSS `?raw` imports come back empty under this setup.
const components = join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'decks');

function rule(file: string, selector: string): string {
  const css = readFileSync(join(components, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector} in ${file}`);
  return m[1];
}

describe('controls on deck-tile art sit on the scrim plate', () => {
  const cases: Array<[string, string]> = [
    ['LikeButton.css', '.decks-index-list.is-grid .tile-action-btn'],
    ['DiscoverDeckTile.css', '.discover-tile-open-pill'],
  ];

  it.each(cases)('%s %s is on --art-scrim at rest', (file, selector) => {
    const body = rule(file, selector);
    expect(body).toMatch(/background:\s*var\(--art-scrim\)/);
    expect(body).toMatch(/color:\s*var\(--art-scrim-text\)/);
  });

  it.each(cases)('%s %s paints no raw color or glyph shadow', (file, selector) => {
    const body = rule(file, selector);
    expect(body).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b|drop-shadow/i);
  });

  it('pressed takes the scrim accent, never the themed accent', () => {
    const body = rule(
      'LikeButton.css',
      ".decks-index-list.is-grid .tile-action-btn[aria-pressed='true']"
    );
    expect(body).toMatch(/color:\s*var\(--art-scrim-accent\)/);
    expect(body).not.toMatch(/var\(--accent\)/);
  });
});

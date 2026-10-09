// One sixth of the settings matrix. See deckGenerator.settings.test-matrix.ts.
import { expect, it } from 'vitest';
import { customization } from './__fixtures__/settings-universe';
import { runSettingsMatrix } from './deckGenerator.settings.test-matrix';

// E601: the whole-deck search is on unless a build says false, runs against a
// 15 s wall clock, and cost the matrix ~30 s per part (2.7 s without it) and
// its determinism. The matrix tests settings, not the search, so the fixture
// turns it off; a case that wants it passes wholeDeckSearch: true.
it('the matrix fixture runs without the whole-deck search unless a case asks for it', () => {
  expect(customization().wholeDeckSearch).toBe(false);
  expect(customization({ wholeDeckSearch: true }).wholeDeckSearch).toBe(true);
});

runSettingsMatrix(0, 6);

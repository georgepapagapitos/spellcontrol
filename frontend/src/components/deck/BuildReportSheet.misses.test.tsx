// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuildReportSheet } from './BuildReportSheet';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

// The post-generation sheet renders the real panel here, so a missed target
// reaches the dialog a player reads right after the build.
describe('BuildReportSheet — target misses (E1006)', () => {
  it('shows the missed target inside the sheet', () => {
    const { getByRole } = render(
      <BuildReportSheet
        deckId="d-miss"
        onClose={vi.fn()}
        report={{
          targetBracket: 3,
          estimatedBracket: 3,
          dataSource: 'theme+bracket',
          builtFromCollection: false,
          targetMisses: [
            { key: 'nonbasic', asked: 11, got: 8, cause: 'no other fitting land for this deck' },
          ],
        }}
      />
    );
    expect(getByRole('dialog').textContent).toContain(
      'Asked for 11 nonbasic lands, got 8: no other fitting land for this deck.'
    );
  });
});

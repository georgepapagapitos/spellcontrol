// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';

vi.mock('@/lib/cards/use-tagger-ready', () => ({ useTaggerReady: () => false }));

// Temporal Tribulation (TRC #51), a week before Star Trek Commander released.
const temporalTribulation = {
  id: 'trc-51',
  oracle_id: 'oracle-temporal-tribulation',
  name: 'Temporal Tribulation',
  cmc: 2,
  type_line: 'Instant',
  color_identity: ['U'],
  keywords: ['Flashback'],
  rarity: 'rare',
  set: 'trc',
  set_name: 'Star Trek Commander',
  released_at: '2026-11-13',
  legalities: { commander: 'not_legal' },
  prices: {},
} as unknown as ScryfallCard;

afterEach(() => vi.useRealTimers());

describe('DeckCardPreviewMeta release line', () => {
  it('says when a previewed card releases, not that it is illegal', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 6));
    const { container } = render(<DeckCardPreviewMeta card={temporalTribulation} />);
    const line = container.querySelector('.deck-card-preview-meta-release');
    expect(line?.textContent).toMatch(/^Releases .*2026$/);
    expect(container.querySelector('.deck-card-preview-meta-warn')).toBeNull();
  });

  it('drops the line once the card is out', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 14));
    const { container } = render(<DeckCardPreviewMeta card={temporalTribulation} />);
    expect(container.querySelector('.deck-card-preview-meta-release')).toBeNull();
  });
});

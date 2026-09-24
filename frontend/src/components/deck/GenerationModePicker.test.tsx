// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCardsLive: vi.fn(async () => ({ data: [], total_cards: 0 })),
}));

import { GenerationModePicker } from './GenerationModePicker';
import { defaultCustomization } from '@/deck-builder/store';

afterEach(() => {
  vi.useRealTimers();
});

// E390: the era slider's ceiling was a hardcoded 2024, so from 2025 on nobody
// could build a deck from the last year or two of cards.
describe('GenerationModePicker: By era', () => {
  it('lets the cutoff reach the current year', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-06-01T12:00:00Z'));

    render(
      <GenerationModePicker
        customization={{ ...defaultCustomization, generationMode: 'historical' }}
        update={() => {}}
        colorIdentity={['R']}
        section="config"
      />
    );

    expect(screen.getByRole('slider', { name: 'Print-year cutoff' }).getAttribute('max')).toBe(
      '2031'
    );
  });
});

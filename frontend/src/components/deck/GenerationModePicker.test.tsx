// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCardsLive: vi.fn(async () => ({ data: [], total_cards: 0 })),
}));

import { GenerationModePicker } from './GenerationModePicker';
import { defaultCustomization } from '@/deck-builder/store';

afterEach(() => {
  vi.useRealTimers();
});

describe('GenerationModePicker: By art', () => {
  it('renders motif presets as a native radio group, with the current tag checked', () => {
    render(
      <GenerationModePicker
        customization={{
          ...defaultCustomization,
          generationMode: 'art-theme',
          artThemeTag: 'dragon',
        }}
        update={() => {}}
        colorIdentity={['R']}
        section="config"
      />
    );
    expect((screen.getByRole('radio', { name: 'Dragons' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Cats' }) as HTMLInputElement).checked).toBe(false);
  });

  it('patches artThemeTag when a motif is picked', () => {
    const update = vi.fn();
    render(
      <GenerationModePicker
        customization={{ ...defaultCustomization, generationMode: 'art-theme', artThemeTag: '' }}
        update={update}
        colorIdentity={['R']}
        section="config"
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Cats' }));
    expect(update).toHaveBeenCalledWith({ artThemeTag: 'cat' });
  });

  it('leaves every chip unchecked for a free-typed motif not in the presets', () => {
    render(
      <GenerationModePicker
        customization={{
          ...defaultCustomization,
          generationMode: 'art-theme',
          artThemeTag: 'lighthouse',
        }}
        update={() => {}}
        colorIdentity={['R']}
        section="config"
      />
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.some((r) => r.checked)).toBe(false);
  });
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

  it('renders era presets as a native radio group, with the current year checked', () => {
    render(
      <GenerationModePicker
        customization={{
          ...defaultCustomization,
          generationMode: 'historical',
          historicalYear: 2005,
        }}
        update={() => {}}
        colorIdentity={['R']}
        section="config"
      />
    );
    expect((screen.getByRole('radio', { name: /Old-School/ }) as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('patches historicalYear when an era preset is picked', () => {
    const update = vi.fn();
    render(
      <GenerationModePicker
        customization={{
          ...defaultCustomization,
          generationMode: 'historical',
          historicalYear: 2005,
        }}
        update={update}
        colorIdentity={['R']}
        section="config"
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /Golden Age/ }));
    expect(update).toHaveBeenCalledWith({ historicalYear: 2010 });
  });
});

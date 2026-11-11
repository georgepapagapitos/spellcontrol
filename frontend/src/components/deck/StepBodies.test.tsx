// @vitest-environment happy-dom
/** The theme and method pickers as bodies of numbered steps (E1113): no section title of their own. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultCustomization } from '@/deck-builder/store';

const { fetchCommanderThemes } = vi.hoisted(() => ({ fetchCommanderThemes: vi.fn() }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({ fetchCommanderThemes }));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCardsLive: vi.fn(async () => ({ data: [], total_cards: 0 })),
}));

import { GenerationModePicker } from './GenerationModePicker';
import { ThemePicker } from './ThemePicker';

describe('ThemePicker bare', () => {
  it('lists the themes with deck counts and no heading of its own', async () => {
    fetchCommanderThemes.mockResolvedValue([
      { name: 'Angels', slug: 'angels', count: 3982, url: '' },
      { name: 'Lifegain', slug: 'lifegain', count: 900, url: '' },
    ]);
    const onToggle = vi.fn();
    render(
      <ThemePicker
        bare
        commanderName="Giada"
        selectedSlugs={new Set(['angels'])}
        onToggle={onToggle}
      />
    );
    const angels = await screen.findByRole('button', { name: /Angels/ });
    expect(angels.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('heading')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Lifegain/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('says so when EDHREC has no themes, instead of an empty step', async () => {
    fetchCommanderThemes.mockResolvedValue([]);
    render(
      <ThemePicker bare commanderName="Nobody" selectedSlugs={new Set()} onToggle={vi.fn()} />
    );
    expect(await screen.findByText(/no themes for this commander/)).toBeTruthy();
  });

  it('unframed, an empty list still renders nothing, as before', async () => {
    fetchCommanderThemes.mockResolvedValue([]);
    const { container } = render(
      <ThemePicker commanderName="Nobody" selectedSlugs={new Set()} onToggle={vi.fn()} />
    );
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('offers a retry in the step when themes fail to load', async () => {
    fetchCommanderThemes.mockRejectedValueOnce(new Error('down')).mockResolvedValue([]);
    render(<ThemePicker bare commanderName="Giada" selectedSlugs={new Set()} onToggle={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByText(/no themes for this commander/);
  });
});

describe('GenerationModePicker bare', () => {
  it('keeps the four methods as one named radio group with no heading', () => {
    const update = vi.fn();
    render(
      <GenerationModePicker
        bare
        groupLabel="Build method"
        customization={defaultCustomization}
        update={update}
        colorIdentity={['W']}
      />
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('group', { name: 'Build method' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(screen.getByRole('radio', { name: /By art/ }));
    expect(update).toHaveBeenCalledWith({ generationMode: 'art-theme' });
  });
});

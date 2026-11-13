// @vitest-environment happy-dom
/**
 * Once a commander is chosen the generator collapses step 1 to this row. It
 * used to show a name-resolved thumbnail (the default printing, not the copy
 * you picked) and nothing of what the card does (2026-11-13).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const thumb = vi.hoisted(() => vi.fn((_name: string) => 'https://cdn.example/by-name.jpg'));
vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: (name?: string) => (name ? thumb(name) : undefined),
}));
const carousel = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: carousel.open, preview: null }),
}));

import { CommanderSummaryRow } from './CommanderSummaryRow';

const marchesa = {
  id: 'sld-2688',
  name: 'Queen Marchesa',
  type_line: 'Legendary Creature — Human Assassin',
  oracle_text:
    'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
  color_identity: ['W', 'B', 'R'],
  image_uris: {
    small: 'https://cards.scryfall.io/small/front/s.jpg',
    normal: 'https://cards.scryfall.io/normal/front/s.jpg',
    large: 'https://cards.scryfall.io/large/front/s.jpg',
    png: 'https://cards.scryfall.io/png/front/s.png',
    art_crop: 'https://cards.scryfall.io/art_crop/front/my-sld.jpg',
    border_crop: 'https://cards.scryfall.io/border_crop/front/s.jpg',
  },
} as unknown as ScryfallCard;

describe('CommanderSummaryRow', () => {
  it("shows the chosen printing's own art, never a lookup by name", () => {
    const { container } = render(<CommanderSummaryRow card={marchesa} onChange={vi.fn()} />);
    const img = container.querySelector('.commander-summary-art img') as HTMLImageElement;
    expect(img.src).toContain('my-sld');
    expect(thumb).not.toHaveBeenCalled();
  });

  it('says what the commander does: its type line and rules text', () => {
    render(<CommanderSummaryRow card={marchesa} onChange={vi.fn()} />);
    expect(screen.getByText('Legendary Creature — Human Assassin')).toBeTruthy();
    expect(screen.getByText(/you become the monarch/)).toBeTruthy();
  });

  it('the art opens the card preview of this printing', () => {
    render(<CommanderSummaryRow card={marchesa} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'View Queen Marchesa' }));
    expect(carousel.open).toHaveBeenCalledWith(
      [{ name: 'Queen Marchesa', label: '', card: marchesa }],
      'Queen Marchesa'
    );
  });
});

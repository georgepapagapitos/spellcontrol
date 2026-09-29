// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { CommanderPickArt } from './CommanderPickArt';

const junji = {
  id: 'b1b3f1e0-0000-4000-8000-000000000001',
  oracle_id: 'b1b3f1e0-0000-4000-8000-000000000002',
  name: 'Junji, the Midnight Sky',
  type_line: 'Legendary Creature — Dragon Spirit',
  mana_cost: '{3}{B}{B}',
  cmc: 5,
  color_identity: ['B'],
  oracle_text: 'Flying, menace',
  set: 'tdc',
  set_name: 'Tarkir: Dragonstorm Commander',
  collector_number: '183',
  rarity: 'mythic',
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/junji.jpg' },
} as unknown as ScryfallCard;

describe('CommanderPickArt', () => {
  it('shows the full card image as a named button', () => {
    render(<CommanderPickArt card={junji} label="Commander" />);
    const btn = screen.getByRole('button', { name: 'Preview Junji, the Midnight Sky' });
    expect(btn.querySelector('img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/normal/front/junji.jpg'
    );
  });

  it('opens the card preview on the picked card when tapped', () => {
    render(<CommanderPickArt card={junji} label="Commander" />);
    expect(document.querySelector('.card-preview-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Junji, the Midnight Sky' }));
    expect(document.querySelector('.card-preview-backdrop')).not.toBeNull();
    expect(document.querySelector('.card-preview-panel')?.textContent).toContain(
      'Junji, the Midnight Sky'
    );
  });
});

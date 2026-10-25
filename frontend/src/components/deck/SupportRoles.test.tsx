// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { REAL } from '@/deck-builder/services/deckBuilder/supportRoles.fixtures';
import { SupportRoles } from './SupportRoles';

const roleFor: Record<string, string> = {
  'Demonic Tutor': 'tutor',
  'Scavenging Ooze': 'graveyardHate',
  'Heroic Intervention': 'protection',
};
vi.mock('@/deck-builder/services/cardFacts', () => ({
  hasCardFacts: () => true,
  loadCardFacts: () => Promise.resolve(true),
  getRoleFacts: (card: { name: string }) =>
    roleFor[card.name] ? [{ role: roleFor[card.name], sub: null, tier: 'primary' }] : [],
}));

const card = (name: string) => REAL[name] as unknown as ScryfallCard;

describe('SupportRoles', () => {
  it('lists the support roles the deck fills and answers by target', () => {
    render(
      <SupportRoles
        cards={[
          card('Demonic Tutor'),
          card('Scavenging Ooze'),
          card('Heroic Intervention'),
          card('Swords to Plowshares'),
        ]}
        colorIdentity={['W', 'B', 'G']}
      />
    );
    expect(screen.getByRole('heading', { name: 'Also in the deck' })).toBeTruthy();
    expect(screen.getByText('Tutors')).toBeTruthy();
    expect(screen.getByText('Protection')).toBeTruthy();
    expect(screen.getByText('Mana sinks')).toBeTruthy();
    // No recursion card, so no recursion row.
    expect(screen.queryByText('Recursion')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Answers by target' })).toBeTruthy();
    // White, black and green can answer an enchantment; the deck has none.
    expect(screen.getByText('Enchantments')).toBeTruthy();
    // Nothing blue in the identity: no stack row to fill.
    expect(screen.queryByText('Spells on the stack')).toBeNull();
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<SupportRoles cards={[card('Sol Ring')]} colorIdentity={['W']} />);
    expect(container.textContent).toBe('');
  });
});

// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommanderProfileCard } from './CommanderProfileCard';
import { Archetype } from '@/deck-builder/types';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';

function makeProfile(overrides: Partial<CommanderProfile> = {}): CommanderProfile {
  return {
    commanderName: 'Sythis, Harvest’s Hand',
    colorIdentity: ['G', 'W'],
    abilities: [],
    primaryArchetype: Archetype.SPELLSLINGER,
    suggestedThemes: [],
    summary: 'Draws cards off enchantments.',
    tribes: [],
    ...overrides,
  };
}

describe('CommanderProfileCard', () => {
  // S3: the pre-build oracle-text keyword vote can disagree with what
  // generation actually builds (EDHREC-aware) — the copy must read as a
  // pre-build guess, never assert the archetype the deck will end up with.
  it('frames the archetype as a card-text read, not a build promise', () => {
    const { container } = render(<CommanderProfileCard profile={makeProfile()} />);
    const footer = container.querySelector('.cmdr-profile-footer')?.textContent ?? '';
    expect(footer).toMatch(/^Reads as: Spellslinger/);
    expect(footer).toMatch(/from card text/);
    expect(footer).not.toMatch(/Detected archetype/);
  });

  // The reading is only "from card text" when nothing but the text decided it. When EDHREC's
  // deck data overruled a Voltron reading (golden R11), the footer says so.
  it('names EDHREC as a source when its deck data overruled the text', () => {
    const { container } = render(
      <CommanderProfileCard
        profile={makeProfile({ primaryArchetype: Archetype.GOODSTUFF, voltronVetoed: true })}
      />
    );
    const footer = container.querySelector('.cmdr-profile-footer')?.textContent ?? '';
    expect(footer).toBe('Reads as: Goodstuff, from card text and EDHREC deck data.');
  });

  it('title-cases the archetype label instead of the raw enum value', () => {
    render(
      <CommanderProfileCard profile={makeProfile({ primaryArchetype: Archetype.GOODSTUFF })} />
    );
    expect(screen.getByText('Goodstuff')).toBeTruthy();
    expect(screen.queryByText('goodstuff')).toBeNull();
  });

  // Themes are never auto-selected (use-deck-generation.ts), and the page
  // right below said "No theme selected" while this card claimed otherwise.
  it('never claims themes were preselected', () => {
    const { container } = render(
      <CommanderProfileCard profile={makeProfile({ suggestedThemes: ['Enchantress', 'Aura'] })} />
    );
    expect(container.textContent).not.toMatch(/preselected/i);
  });
});

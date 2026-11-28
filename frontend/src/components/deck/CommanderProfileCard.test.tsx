// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
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

  // Inside generator step 1 (E1113) it is a disclosure. The summary row above it already
  // shows the rules text the breakdown quotes, so on a first visit it starts closed.
  it('as a step disclosure it starts collapsed, opens on demand, and is a level-3 heading', () => {
    localStorage.clear();
    // The stand-alone card's saved "open" does not open the step disclosure.
    localStorage.setItem('spellcontrol-game-plan-collapsed', '0');
    render(<CommanderProfileCard profile={makeProfile()} title="What Giada wants" />);
    const toggle = screen.getByRole('button', { name: 'What Giada wants' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('heading', { level: 3, name: 'What Giada wants' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it("opening the step disclosure never writes the stand-alone card's saved choice", () => {
    localStorage.clear();
    // Saved closed; the step opening must leave it closed.
    localStorage.setItem('spellcontrol-game-plan-collapsed', '1');
    render(<CommanderProfileCard profile={makeProfile()} title="What Giada wants" />);
    fireEvent.click(screen.getByRole('button', { name: 'What Giada wants' }));
    expect(localStorage.getItem('spellcontrol-game-plan-collapsed')).toBe('1');
  });

  // E1115 (b): closed, a step disclosure states its read, as every kit Disclosure states its
  // value, so a closed breakdown is never just a title. The read is the description, so the
  // heading's name stays the title, open or closed.
  it('closed, the step disclosure names what the commander reads as', () => {
    localStorage.clear();
    render(
      <CommanderProfileCard
        profile={makeProfile({ primaryArchetype: Archetype.TOKENS })}
        title="What Giada wants"
      />
    );
    const toggle = screen.getByRole('button', { name: 'What Giada wants' });
    expect(toggle.textContent).toContain('Tokens');
    expect(screen.getByRole('button', { name: 'What Giada wants', description: 'Tokens' })).toBe(
      toggle
    );
    expect(screen.getByRole('heading', { level: 3, name: 'What Giada wants' })).toBeTruthy();
    fireEvent.click(toggle);
    // Open, the footer says it instead, and the name has not moved.
    expect(toggle.textContent).not.toContain('Tokens');
    expect(toggle.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'What Giada wants' })).toBeTruthy();
  });

  // E1115 (b): the step disclosure remembers the player's last choice, as More settings does.
  it('the step disclosure reopens the way the player left it', () => {
    localStorage.clear();
    const first = render(<CommanderProfileCard profile={makeProfile()} title="What Giada wants" />);
    fireEvent.click(screen.getByRole('button', { name: /What Giada wants/ }));
    first.unmount();
    render(<CommanderProfileCard profile={makeProfile()} title="What Sythis wants" />);
    expect(
      screen.getByRole('button', { name: /What Sythis wants/ }).getAttribute('aria-expanded')
    ).toBe('true');
  });
});

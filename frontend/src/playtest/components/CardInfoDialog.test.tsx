// @vitest-environment happy-dom
/**
 * Guard: "View information" opens ONE centered dialog that answers the
 * question it was opened for — what this card does, what it's doing right
 * now, and what the rulings say — without the carousel chrome (flanking
 * slides, page counter, swipe rail) that made a single permanent fill the
 * screen with its text pushed into a side column.
 *
 * The rulings assertion is the load-bearing one: they are fetched on mount
 * here, not behind a chevron, because a ruling is usually why the dialog was
 * opened mid-game.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardInfoDialog } from './CardInfoDialog';

vi.mock('@/lib/card-rulings', () => ({
  fetchCardRulings: () =>
    Promise.resolve([
      {
        published_at: '2014-11-24',
        comment:
          "You don't have to attack with the creature with dash unless another ability says you do.",
        source: 'wotc',
      },
    ]),
}));

// Real printing, real oracle text (Fate Reforged #102).
const heelcutter = {
  id: '0d4c2e52-1111-4222-8333-444444444444',
  name: 'Goblin Heelcutter',
  mana_cost: '{3}{R}',
  type_line: 'Creature — Goblin Berserker',
  oracle_text:
    "Whenever this creature attacks, target creature can't block this turn.\nDash {2}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)",
  power: '3',
  toughness: '2',
  set: 'frf',
  set_name: 'Fate Reforged',
  collector_number: '102',
  rarity: 'common',
  legalities: { commander: 'legal', standard: 'not_legal' },
  image_uris: { normal: 'https://cards.example/heelcutter.jpg' },
} as unknown as ScryfallCard;

// A transform card: two faces, the back one with no mana cost of its own.
const delver = {
  id: '1a2b3c4d-1111-4222-8333-444444444444',
  name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform',
  card_faces: [
    {
      name: 'Delver of Secrets',
      mana_cost: '{U}',
      type_line: 'Creature — Human Wizard',
      oracle_text:
        'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.',
      power: '1',
      toughness: '1',
      image_uris: { normal: 'https://cards.example/delver-front.jpg' },
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
      power: '3',
      toughness: '2',
      image_uris: { normal: 'https://cards.example/delver-back.jpg' },
    },
  ],
  set: 'inr',
  set_name: 'Innistrad Remastered',
  collector_number: '60',
  rarity: 'common',
} as unknown as ScryfallCard;

describe('CardInfoDialog', () => {
  it('reads the card: name, type line, rules text and body', () => {
    render(<CardInfoDialog card={heelcutter} onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Goblin Heelcutter' })).toBeTruthy();
    expect(screen.getByText('Creature — Goblin Berserker')).toBeTruthy();
    expect(screen.getByText(/target creature can't block this turn/)).toBeTruthy();
    expect(screen.getByText('3/2')).toBeTruthy();
  });

  it('shows the rulings without asking for a second click', async () => {
    render(<CardInfoDialog card={heelcutter} onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/You don't have to attack with the creature with dash/)).toBeTruthy()
    );
  });

  it('prints the live board state beside the printed card', () => {
    render(
      <CardInfoDialog
        card={heelcutter}
        status={{
          card: { id: 'c1', name: 'Goblin Heelcutter' },
          bf: {
            card: { id: 'c1', name: 'Goblin Heelcutter' },
            tapped: true,
            counters: { '+1/+1': 2 },
            stickers: [],
            x: 0,
            y: 0,
            faceDown: false,
          },
          tax: 4,
        }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Tapped')).toBeTruthy();
    expect(screen.getByText('+1/+1 ×2')).toBeTruthy();
    expect(screen.getByText('Commander tax +4')).toBeTruthy();
  });

  it('is a dialog, not a carousel', () => {
    render(<CardInfoDialog card={heelcutter} onClose={() => {}} />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    // The carousel's page counter / section label chrome has no place here.
    expect(screen.queryByText(/Page 1/)).toBeNull();
  });

  it("heads a transform card with the front face's cost, not a dangling separator", () => {
    render(<CardInfoDialog card={delver} onClose={() => {}} />);

    // The dialog portals to <body>, so the header is reached through the
    // front-face type line rather than RTL's own container.
    const header = screen.getAllByText('Creature — Human Wizard')[0].closest('.card-info-typeline');
    // EnrichedCard.manaCost joins faces with "//" and the back face has no
    // cost of its own, so the joined form rendered "{U} //" in the header.
    expect(header?.textContent).not.toContain('//');
  });

  it('offers the other face of a transform card by name', () => {
    render(<CardInfoDialog card={delver} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Insectile Aberration' })).toBeTruthy();
  });
});

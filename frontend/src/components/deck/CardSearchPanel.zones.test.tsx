// @vitest-environment happy-dom
/**
 * The mainboard is the only zone the format's deckbuilding rules govern. These
 * cover the two filters that used to run in every zone and made cards that are
 * physically in the deck box unfindable in Sideboard / Considering:
 * the command-zone exclusion, and the colour-identity/legality gate.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('../../lib/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('../../lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('../../lib/aggregates-client', () => ({ getCommanderStats: () => Promise.resolve(null) }));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: () => Promise.resolve(null),
}));

function card(name: string, colorIdentity: string[], legal = 'legal'): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    colorIdentity,
    legalities: { commander: legal },
  } as unknown as EnrichedCard;
}

const COMMANDER = 'Zada, Hedron Grinder';

// The panel opens on Suggestions for a commander deck; these assertions are
// about the Collection tab, so switch to it.
function renderPanel(addZone: 'main' | 'side' | 'considering') {
  const r = render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      onAdd={() => {}}
      onClose={() => {}}
      enableSuggestions
      commanderNames={[COMMANDER]}
      addZone={addZone}
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  return r;
}

describe('CardSearchPanel — out-of-deck zones accept any card', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [
        card(COMMANDER, ['R']),
        card('Counterspell', ['U']),
        card('Black Lotus', [], 'banned'),
        card('Lightning Bolt', ['R']),
      ],
    });
  });

  it('applies the mainboard rules on Mainboard: no commander, no off-colour, no illegal card', () => {
    renderPanel('main');
    // The in-identity, legal card proves rows render at all — without it the
    // three absence assertions below would pass on an empty list.
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.queryByText(COMMANDER)).toBeNull();
    expect(screen.queryByText('Counterspell')).toBeNull();
    expect(screen.queryByText('Black Lotus')).toBeNull();
  });

  it('lifts all three on Sideboard — they are legitimate swap-pile cards', () => {
    renderPanel('side');
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText(COMMANDER)).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
    expect(screen.getByText('Black Lotus')).toBeTruthy();
  });

  it('lifts all three on Considering too', () => {
    renderPanel('considering');
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText(COMMANDER)).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
    expect(screen.getByText('Black Lotus')).toBeTruthy();
  });
});

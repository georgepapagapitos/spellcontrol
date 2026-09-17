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
function renderPanel(
  addZone: 'main' | 'side' | 'considering',
  atCopyLimit: (name: string) => boolean = () => false
) {
  const r = render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      atCopyLimit={atCopyLimit}
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

  it('says how many owned cards the mainboard rules hid, instead of leaving them silently missing', () => {
    renderPanel('main');
    // Counterspell (off-colour) + Black Lotus (banned). The commander is not
    // counted: it is excluded by name, not by the mainboard legality rules.
    expect(screen.getByText(/2 cards you own match but cannot go in the mainboard/)).toBeTruthy();
    expect(screen.queryByText('Counterspell')).toBeNull();
  });

  it('reveals the hidden cards on demand, badged, without burying the playable ones', () => {
    renderPanel('main');
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));

    const rows = Array.from(document.querySelectorAll('.card-search-row'));
    const names = rows.map((r) => r.querySelector('.card-search-name')?.textContent);
    expect(names).toContain('Counterspell');
    // Playable cards stay ahead of the ones that cannot be played.
    expect(names.indexOf('Lightning Bolt')).toBeLessThan(names.indexOf('Counterspell'));

    const revealed = screen.getByText('Counterspell').closest('li');
    expect(revealed?.textContent).toContain('Off-color');
    expect(screen.getByRole('button', { name: 'Hide them' })).toBeTruthy();
  });

  it('shows no such note in the out-of-deck zones, where nothing is held back', () => {
    renderPanel('side');
    expect(screen.queryByText(/cannot go in the mainboard/)).toBeNull();
  });

  it('lifts all three on Sideboard — they are legitimate swap-pile cards', () => {
    renderPanel('side');
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText(COMMANDER)).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
    expect(screen.getByText('Black Lotus')).toBeTruthy();
  });

  it('labels what it now lets through, so the card is named as unplayable in the 99', () => {
    renderPanel('side');
    // Scoped to the row, not the document: a stray badge elsewhere would
    // otherwise satisfy a bare getByText.
    const offColorRow = screen.getByText('Counterspell').closest('li');
    expect(offColorRow?.textContent).toContain('Off-color');
    const illegalRow = screen.getByText('Black Lotus').closest('li');
    expect(illegalRow?.textContent).toContain('Not legal');

    const fineRow = screen.getByText('Lightning Bolt').closest('li');
    expect(fineRow?.textContent).not.toContain('Off-color');
    expect(fineRow?.textContent).not.toContain('Not legal');
  });

  it('lifts all three on Considering too', () => {
    renderPanel('considering');
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText(COMMANDER)).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
    expect(screen.getByText('Black Lotus')).toBeTruthy();
  });
});

/**
 * The deck row's overflow menu already refuses "Add another copy" at the copy
 * limit (`DeckMainboardRow`: `disabled={atCap}`, with the comment "add
 * affordances agree by construction, not by convention"). The Add cards panel
 * did not, so it would build an illegal deck — measured in the playtest sweep
 * (batch 6): adding Sol Ring to a Commander deck that already had one produced
 * a server row reading `[['Island', 28], ['Sol Ring', 2]]`, which the Stats tab
 * then reported as "Singleton — 1 duplicate name".
 */
describe('CardSearchPanel — the copy limit', () => {
  beforeEach(() => {
    useCollectionStore.setState({ cards: [card('Lightning Bolt', ['R'])] });
  });

  it('refuses a card already at its copy limit, and says why', () => {
    renderPanel('main', (name) => name === 'Lightning Bolt');
    const add = screen.getByRole('button', {
      name: 'Lightning Bolt is already at its copy limit',
    });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds normally when the card is below its limit', () => {
    renderPanel('main');
    const add = screen.getByRole('button', { name: 'Add Lightning Bolt' });
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });
});

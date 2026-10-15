// @vitest-environment happy-dom
/**
 * E1025: the add-cards Filters dialog carries mana value (chips + 7+ drill)
 * and printed mana cost symbols, applied over the owned rows in the
 * Collection tab. Real oracle costs.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStats: () => Promise.resolve(null),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: () => Promise.resolve(null),
}));

function card(name: string, manaCost: string, cmc: number, ci: string[]): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    manaCost,
    cmc,
    colorIdentity: ci,
    legalities: { commander: 'legal' },
  } as unknown as EnrichedCard;
}

const names = () =>
  Array.from(document.querySelectorAll('.inline-card-search-row')).map(
    (r) => r.querySelector('.inline-card-search-name')?.textContent
  );

const dlg = () => screen.getByRole('dialog', { name: 'Collection filters' });
const show = () => fireEvent.click(within(dlg()).getByRole('button', { name: /^Show / }));

function renderPanel() {
  render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['U', 'B']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={() => {}}
      onClose={() => {}}
      addZone="main"
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
}

describe('CardSearchPanel: mana value and mana cost filters', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [
        card('Gray Merchant of Asphodel', '{3}{B}{B}', 5, ['B']),
        card('Counterspell', '{U}{U}', 2, ['U']),
        card('Inkwell Leviathan', '{7}{U}{U}', 9, ['U']),
      ],
    });
  });

  it('MV 7+ drilled to 9 narrows to the nine-drop', () => {
    renderPanel();
    fireEvent.click(within(dlg()).getByRole('button', { name: '7+' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: '9' }));
    show();
    expect(names()).toEqual(['Inkwell Leviathan']);
  });

  it('at least BB keeps Gray Merchant only; the filter badge counts it', () => {
    renderPanel();
    fireEvent.click(within(dlg()).getByRole('button', { name: /More filters/ }));
    const addB = within(dlg()).getByRole('button', { name: 'Add black mana' });
    fireEvent.click(addB);
    fireEvent.click(addB);
    show();
    expect(names()).toEqual(['Gray Merchant of Asphodel']);
    expect(screen.getByRole('button', { name: /^Filters/ }).textContent).toMatch(/1/);
  });
});

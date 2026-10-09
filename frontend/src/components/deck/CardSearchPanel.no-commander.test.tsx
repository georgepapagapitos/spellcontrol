// @vitest-environment happy-dom
/**
 * E465: a commander deck can take cards before it has a commander. Until one
 * is chosen there is no color identity to check, so the mainboard search
 * shows every color and says so once; the format's legality still applies,
 * judged against the deck's own format rather than hard-coded Commander.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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

function card(
  name: string,
  colorIdentity: string[],
  legalities: Record<string, string> = { commander: 'legal', paupercommander: 'legal' }
): EnrichedCard {
  return { id: name, name, quantity: 1, colorIdentity, legalities } as unknown as EnrichedCard;
}

const NOTE = 'No commander yet, so every color shows.';

describe('CardSearchPanel — a commander deck with no commander yet', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [
        card('Lightning Bolt', ['R']),
        card('Counterspell', ['U']),
        card('Swords to Plowshares', ['W']),
        card('Black Lotus', [], { commander: 'banned', paupercommander: 'banned' }),
      ],
    });
  });

  function renderPanel(extra: Partial<Parameters<typeof CardSearchPanel>[0]> = {}) {
    return render(
      <CardSearchPanel
        deckId="deck-1"
        commanderColorIdentity={[]}
        existingCardCounts={new Map()}
        atCopyLimit={() => false}
        onAdd={() => {}}
        onClose={() => {}}
        enableSuggestions={false}
        noCommanderYet
        commanderNames={[]}
        addZone="main"
        {...extra}
      />
    );
  }

  it('shows owned cards of every color on the mainboard, and says why once', () => {
    renderPanel();
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
    expect(screen.getByText('Swords to Plowshares')).toBeTruthy();
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    // A fact about the search, not a warning: the quiet note, not the warn tone.
    expect(screen.getByText(NOTE).className).toContain('card-search-tag-note--quiet');
    // Nothing is badged off-color: there is no identity to be off.
    expect(screen.queryByText('Off-color')).toBeNull();
  });

  it('still holds back a card the format bans', () => {
    renderPanel();
    expect(screen.queryByText('Black Lotus')).toBeNull();
    expect(screen.getByText(/1 card you own matches but cannot go in the mainboard/)).toBeTruthy();
  });

  it('offers no Suggestions tab until there is a commander to suggest for', () => {
    renderPanel();
    expect(screen.queryByRole('tab', { name: /Suggestions/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Collection/, selected: true })).toBeTruthy();
  });

  it('judges legality by the deck format, not Commander', () => {
    useCollectionStore.setState({
      cards: [
        // Legal in Commander, banned in Pauper Commander.
        card('Mnemonic Wall', ['U'], { commander: 'legal', paupercommander: 'banned' }),
        card('Lightning Bolt', ['R']),
      ],
    });
    renderPanel({ legalityKey: 'paupercommander' });
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.queryByText('Mnemonic Wall')).toBeNull();
  });
});

describe('CardSearchPanel — a chosen commander still filters by its identity', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [card('Lightning Bolt', ['R']), card('Sol Ring', [])],
    });
  });

  // `[]` is a real identity (a colorless commander), not "no commander": only
  // the explicit noCommanderYet flag lifts the color rule.
  it('keeps hiding colored cards for a colorless commander', () => {
    render(
      <CardSearchPanel
        deckId="deck-1"
        commanderColorIdentity={[]}
        existingCardCounts={new Map()}
        atCopyLimit={() => false}
        onAdd={() => {}}
        onClose={() => {}}
        enableSuggestions
        commanderNames={['Karn, Silver Golem']}
        addZone="main"
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.queryByText('Lightning Bolt')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

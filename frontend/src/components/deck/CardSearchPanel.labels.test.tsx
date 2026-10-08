// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import type { GapAnalysisCard, HiddenGemRow, ScryfallCard } from '@/deck-builder/types';
import {
  resetSuggestionLabelsForTests,
  setSuggestionContext,
  setSuggestionLabelsEnabled,
} from '@/lib/util/suggestion-labels';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByNameResilient: async (name: string) => ({ id: `id-${name}`, name }),
}));

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'deck-secret-1',
    commander: { name: "Atraxa, Praetors' Voice", oracle_id: ATRAXA } as ScryfallCard,
    partnerCommander: null,
  });
});

const gap = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;
const gem = {
  name: 'Grave Pact',
  typeLine: 'Enchantment',
  price: null,
  signals: [],
} as unknown as HiddenGemRow;

function renderPanel() {
  const onAdd = vi.fn();
  render(
    <CardSearchPanel
      deckId="deck-secret-1"
      commanderColorIdentity={['W', 'U', 'B', 'G']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      enableSuggestions
      suggestions={[gap]}
      hiddenGems={[gem]}
      ownershipFor={() => 'owned'}
    />
  );
  return onAdd;
}

describe('CardSearchPanel suggestion labels', () => {
  it('counts each group and labels an added staple and an added hidden gem by group and rank', async () => {
    const onAdd = renderPanel();
    expect(sent.map((p) => [p.surface, p.n])).toEqual(
      expect.arrayContaining([
        ['add-suggestions', 1],
        ['hidden-gems', 1],
      ])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add Grave Pact' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    const accepts = sent.filter((p) => p.action === 'accept');
    expect(accepts).toEqual([
      expect.objectContaining({
        surface: 'add-suggestions',
        rank: 1,
        reason: 'staple',
        cardIn: 'Cultivate',
        cmdr: ATRAXA,
      }),
      expect.objectContaining({
        surface: 'hidden-gems',
        rank: 1,
        reason: 'hidden-gem',
        cardIn: 'Grave Pact',
      }),
    ]);
    expect(JSON.stringify(sent)).not.toContain('deck-secret-1');
  });

  it('sends nothing when the player opted out', async () => {
    setSuggestionLabelsEnabled(false);
    const onAdd = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(sent).toEqual([]);
  });
});

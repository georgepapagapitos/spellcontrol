// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import type { EnrichedCard } from '../../types';
import { CubeBuildPage } from './CubeBuildPage';

let seq = 0;
function card(name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  seq += 1;
  return {
    copyId: `copy-${seq}`,
    name,
    setCode: 'CMM',
    setName: 'Commander Masters',
    collectorNumber: String(seq),
    rarity: 'uncommon',
    scryfallId: `sf-${seq}`,
    purchasePrice: 1.5,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    cmc: 1,
    colorIdentity: [],
    colors: [],
    legalities: { commander: 'legal' },
    ...over,
  } as EnrichedCard;
}

beforeEach(() => {
  seq = 0;
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({
    cards: [card('Sol Ring'), card('Arcane Signet'), card('Swords to Plowshares')],
  });
  useDecksStore.setState({ decks: [] });
  localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CubeBuildPage />
    </MemoryRouter>
  );
}

describe('CubeBuildPage — card priority', () => {
  it('Power / Balanced / Themed map to synergyLevel 0 / 0.5 / 1 and each shows its own note', () => {
    renderPage();
    const power = screen.getByRole('radio', { name: 'Power' });
    const balanced = screen.getByRole('radio', { name: 'Balanced' });
    const themed = screen.getByRole('radio', { name: 'Themed' });
    expect((power as HTMLInputElement).value).toBe('0');
    expect((balanced as HTMLInputElement).value).toBe('0.5');
    expect((themed as HTMLInputElement).value).toBe('1');
    expect(power.hasAttribute('checked') || (power as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/no archetype shaping/)).toBeTruthy();

    fireEvent.click(themed);
    expect(screen.getByText(/collection can actually support/)).toBeTruthy();
  });
});

describe('CubeBuildPage — size', () => {
  it('shows how many cards short the filtered pool is of each size', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Cube size/ }));
    // 3 cards owned, a 540 cube needs 540 — the option states the shortfall.
    expect(screen.getAllByText(/540.*short/).length).toBeGreaterThan(0);
  });
});

describe('CubeBuildPage — Draw from', () => {
  it('the closed Disclosure states the current pool setting', () => {
    renderPage();
    expect(screen.getByText('Available cards · any price · any rarity')).toBeTruthy();
  });
});

// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrewRunningDeck } from './BrewRunningDeck';
import { useBrewStore } from '@/deck-builder/store/brew';
import type { BrewSlotDef, BrewCandidate } from '@/deck-builder/services/deckBuilder/brewSlots';

// Stub the CDN thumb hook so tests don't fire real network requests — return
// a deterministic URL keyed on the card name so we can assert per-row art.
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: (name: string | undefined) =>
    name ? `https://cdn.example/${name}.jpg` : undefined,
}));

// The mana-curve/color meters resolve accepted cards via getCardsByNames —
// stub it to an empty resolve so this test stays focused on the pick list.
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: async () => new Map(),
}));

function candidate(name: string): BrewCandidate {
  return { name, price: null, inclusion: 0, synergy: 0, typeLine: 'Creature', isOwned: false };
}

const SLOTS: BrewSlotDef[] = [
  { key: 'ramp', label: 'Ramp', purpose: 'Accelerate mana', target: 2 },
];

describe('BrewRunningDeck pick-list art', () => {
  beforeEach(() => {
    useBrewStore.setState({
      slots: SLOTS,
      accepted: { ramp: [candidate('Sol Ring'), candidate('Arcane Signet')] },
      nonlandTotal: 62,
    });
  });

  afterEach(() => {
    useBrewStore.setState({ slots: [], accepted: {} });
  });

  it('renders a decorative CDN thumb per accepted pick', () => {
    render(<BrewRunningDeck commander={null} />);
    // Two accepted picks -> two thumb wrappers, each aria-hidden (decorative).
    const thumbs = document.querySelectorAll('.brew-running-item-thumb');
    expect(thumbs.length).toBe(2);
    expect(thumbs[0].getAttribute('aria-hidden')).toBe('true');

    const solRingImg = thumbs[0].querySelector('img');
    expect(solRingImg?.getAttribute('src')).toBe('https://cdn.example/Sol Ring.jpg');
    expect(solRingImg?.getAttribute('alt')).toBe('');
  });

  it('still shows the card name next to its thumb', () => {
    render(<BrewRunningDeck commander={null} />);
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Arcane Signet')).toBeTruthy();
  });

  it('shows the empty state with no thumbs when nothing is accepted yet', () => {
    useBrewStore.setState({ accepted: { ramp: [] } });
    render(<BrewRunningDeck commander={null} />);
    expect(screen.getAllByText(/Nothing added yet/i).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.brew-running-item-thumb').length).toBe(0);
  });
});

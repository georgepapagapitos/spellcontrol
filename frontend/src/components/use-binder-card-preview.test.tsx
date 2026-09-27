// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useBinderCardPreview } from './use-binder-card-preview';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import type { BinderDef, EnrichedCard } from '../types';

const rock = {
  copyId: 'c-rock',
  scryfallId: 'sf-rock',
  oracleId: 'o-rock',
  name: 'Mind Stone',
  typeLine: 'Artifact',
  colorIdentity: [],
  rarity: 'uncommon',
  purchasePrice: 0.5,
  setCode: 'tst',
  collectorNumber: '1',
  imageNormal: 'https://example.test/mind-stone.jpg',
} as unknown as EnrichedCard;

const artifacts: BinderDef = {
  id: 'b-artifacts',
  name: 'Artifacts',
  position: 0,
  filterGroups: [
    {
      name: 'Rocks',
      filter: { typeTokenChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] } },
    },
  ],
  sorts: [],
  pocketSize: 9,
  doubleSided: false,
  fixedCapacity: null,
  color: '#888',
  createdAt: 0,
  updatedAt: 0,
};

afterEach(cleanup);

function setup() {
  useCollectionStore.setState({ cards: [rock], binders: [artifacts] });
  const [binder] = materializeBinders([rock], [artifacts], { search: '' }).binders;
  return renderHook(() => useBinderCardPreview(binder));
}

describe('useBinderCardPreview', () => {
  it('leads the preview with why the card is here', () => {
    const { result } = setup();
    render(<>{result.current.renderCardMeta(rock)}</>);
    expect(screen.getByText('Filed by the rule “Rocks”.')).toBeTruthy();
  });

  // Move hands the card to the move sheet, so the preview closes as it opens
  // (the row menu's "Move to binder", reachable now from the preview too).
  it('offers Move to binder, which closes the preview and opens the move sheet', () => {
    const { result, rerender } = setup();
    const move = result.current.getCardActions(rock).find((a) => a.key === 'move');
    expect(move?.label).toBe('Move to binder');
    expect(move?.closesPreview).toBe(true);
    expect(result.current.sheet).toBeNull();

    act(() => move!.onClick());
    rerender();
    render(<>{result.current.sheet}</>);
    expect(screen.getByText('Mind Stone')).toBeTruthy();
    expect(screen.getByText('Already here')).toBeTruthy();
  });

  it('keeps Set cover for a card with art', () => {
    const { result } = setup();
    expect(result.current.getCardActions(rock).map((a) => a.key)).toEqual(['move', 'cover']);
  });

  it('offers nothing when no binder is open', () => {
    const { result } = renderHook(() => useBinderCardPreview(undefined));
    expect(result.current.getCardActions(rock)).toEqual([]);
    expect(result.current.renderCardMeta(rock)).toBeNull();
  });
});

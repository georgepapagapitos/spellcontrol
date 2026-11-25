// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { useBuildDeckAction } from './use-build-deck-action';
import type { EnrichedCard } from '@/types/index';

afterEach(cleanup);

function card(o: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: 'c-1',
    scryfallId: 'sf-1',
    name: 'Card',
    typeLine: 'Instant',
    oracleText: '',
    legalities: { commander: 'legal' },
    ...o,
  } as EnrichedCard;
}

function setup() {
  let location: Location | null = null;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/collection']}>{children}</MemoryRouter>
  );
  const { result } = renderHook(
    () => {
      location = useLocation();
      return useBuildDeckAction();
    },
    { wrapper }
  );
  return { build: result.current, location: () => location! };
}

describe('useBuildDeckAction', () => {
  it('offers Build a deck for a legendary creature legal in Commander', () => {
    const { build } = setup();
    const action = build(card({ name: "Atraxa, Praetors' Voice", typeLine: 'Legendary Creature' }));
    expect(action?.label).toBe('Build a deck');
    expect(action?.shortLabel).toBe('Build');
    expect(action?.closesPreview).toBe(true);
    expect(action?.overflow).toBeFalsy();
  });

  it('offers it for a card whose text says it can be your commander', () => {
    const { build } = setup();
    const action = build(
      card({
        name: 'Teferi, Temporal Archmage',
        typeLine: 'Legendary Planeswalker',
        oracleText: 'teferi, temporal archmage can be your commander.',
      })
    );
    expect(action).not.toBeNull();
  });

  it.each([
    ['a creature that is not legendary', { typeLine: 'Creature' }],
    ['a legendary sorcery', { typeLine: 'Legendary Sorcery' }],
    [
      'a land whose back face is a legendary creature',
      { typeLine: 'Legendary Land // Legendary Creature' },
    ],
    [
      'a commander banned in Commander',
      { typeLine: 'Legendary Creature', legalities: { commander: 'banned' } },
    ],
    ['a card with no legality data', { typeLine: 'Legendary Creature', legalities: undefined }],
  ])('offers nothing for %s', (_label, o) => {
    const { build } = setup();
    expect(build(card(o as Partial<EnrichedCard>))).toBeNull();
  });

  it('offers nothing with no card', () => {
    const { build } = setup();
    expect(build(undefined)).toBeNull();
  });

  // The generator reads ?commander= and picks it; ownedFirst turns on
  // "Lean on mine", as the post-import moment does.
  it('opens the generator with the commander picked, owned cards first', () => {
    const { build, location } = setup();
    const action = build(
      card({
        name: 'Esika, Queen of Myrnas // The Prismatic Bridge',
        typeLine: 'Legendary Creature // Legendary Enchantment',
      })
    );
    act(() => action!.onClick());
    expect(location().pathname).toBe('/decks/new/generate');
    expect(new URLSearchParams(location().search).get('commander')).toBe(
      'Esika, Queen of Myrnas // The Prismatic Bridge'
    );
    expect(location().state).toEqual({ ownedFirst: true });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { addedCardMessage, landedFinish } from './add-card-message';
import { useScannerSettings } from '@/lib/scanner/scanner-settings';

const card = (finishes: string[]) =>
  ({
    name: 'Ragavan, Nimble Pilferer',
    set: 'mh2',
    collector_number: '138',
    finishes,
  }) as unknown as ScryfallCard;

beforeEach(() => {
  useScannerSettings.getState().set({ defaultFinish: 'nonfoil' });
});

describe('landedFinish', () => {
  it('uses a named finish as given', () => {
    useScannerSettings.getState().set({ defaultFinish: 'foil' });
    expect(landedFinish(card(['nonfoil', 'foil']), 'nonfoil', true)).toBe('nonfoil');
  });

  it('gives a quick add the Add settings default when the printing has it', () => {
    useScannerSettings.getState().set({ defaultFinish: 'foil' });
    expect(landedFinish(card(['nonfoil', 'foil']), undefined, true)).toBe('foil');
    expect(landedFinish(card(['nonfoil']), undefined, true)).toBe('nonfoil');
  });

  it("gives anything that isn't a quick add the printing's first finish", () => {
    useScannerSettings.getState().set({ defaultFinish: 'foil' });
    expect(landedFinish(card(['nonfoil', 'foil']))).toBe('nonfoil');
    expect(landedFinish(card(['foil']))).toBe('foil');
  });
});

// With the Foil default, a quick add saved foil but the toast said "Non-foil":
// the toast worked the finish out on its own. It now asks landedFinish too.
describe('addedCardMessage', () => {
  it('names the finish a quick add actually lands as', () => {
    useScannerSettings.getState().set({ defaultFinish: 'foil' });
    expect(addedCardMessage(card(['nonfoil', 'foil']), 1, undefined, false, true)).toBe(
      'Added Ragavan, Nimble Pilferer · MH2 #138 · Foil'
    );
  });
});

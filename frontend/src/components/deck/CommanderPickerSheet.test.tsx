// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { CommanderPickerSheet } from './CommanderPickerSheet';

vi.mock('../../lib/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

// The search is its own tested component; here it only has to hand a pick
// (or a cleared value) back through the props the sheet wires.
const SEARCHED = { id: 'sf-mob', name: 'Krenko, Mob Boss' } as unknown as ScryfallCard;
vi.mock('./CommanderSearch', () => ({
  CommanderSearch: (p: {
    value: ScryfallCard | null;
    format: string;
    onSelect: (c: ScryfallCard | null) => void;
    onSelectFromBinder?: (c: ScryfallCard) => void;
  }) => (
    <div data-testid="commander-search" data-format={p.format} data-value={String(p.value)}>
      <button type="button" onClick={() => p.onSelect(SEARCHED)}>
        Search pick
      </button>
      <button type="button" onClick={() => p.onSelect(null)}>
        Search clear
      </button>
      <button type="button" onClick={() => p.onSelectFromBinder?.(SEARCHED)}>
        Binder pick
      </button>
    </div>
  ),
}));

function sf(
  name: string,
  typeLine: string,
  extra: Partial<Record<'rarity' | 'color_identity', unknown>> = {}
): ScryfallCard {
  return {
    id: `sf-${name}`,
    name,
    type_line: typeLine,
    color_identity: ['R'],
    legalities: { commander: 'legal', paupercommander: 'legal' },
    rarity: 'rare',
    ...extra,
  } as unknown as ScryfallCard;
}

const KRENKO = sf('Krenko, Tin Street Kingpin', 'Legendary Creature — Goblin Warrior');
const MUXUS = sf('Muxus, Goblin Grandee', 'Legendary Creature — Goblin Noble');
const BOLT = sf('Lightning Bolt', 'Instant');
const CHIEFTAIN = sf('Goblin Chieftain', 'Creature — Goblin', { rarity: 'uncommon' });

function renderSheet(props: Partial<Parameters<typeof CommanderPickerSheet>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <CommanderPickerSheet
      format="commander"
      deckCards={[KRENKO, BOLT, MUXUS, KRENKO]}
      onPick={onPick}
      onClose={onClose}
      {...props}
    />
  );
  return { onPick, onClose };
}

describe('CommanderPickerSheet (E465)', () => {
  it('is a labelled sheet you pick from: bottom sheet on phones, centred above', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Choose a commander' });
    expect(dialog.parentElement?.className).toContain('modal-backdrop--sheet');
  });

  it('leads with the legends already in the deck, once each, and a tap picks one', () => {
    const { onPick } = renderSheet();
    const section = screen.getByRole('region', { name: 'In this deck' });
    const tiles = within(section).getAllByRole('button');
    expect(tiles.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Krenko, Tin Street Kingpin'),
      expect.stringContaining('Muxus, Goblin Grandee'),
    ]);
    fireEvent.click(tiles[1]);
    expect(onPick).toHaveBeenCalledWith(MUXUS);
  });

  it('judges eligibility by the deck format (PDH: an uncommon creature, not a legend)', () => {
    renderSheet({ format: 'paupercommander', deckCards: [KRENKO, CHIEFTAIN] });
    const section = screen.getByRole('region', { name: 'In this deck' });
    expect(section.textContent).toContain('Goblin Chieftain');
    expect(section.textContent).not.toContain('Krenko');
    expect(screen.getByTestId('commander-search').dataset.format).toBe('paupercommander');
  });

  it('leaves out the commander already seated', () => {
    renderSheet({ exclude: ['Krenko, Tin Street Kingpin'] });
    const section = screen.getByRole('region', { name: 'In this deck' });
    expect(section.textContent).not.toContain('Krenko');
    expect(section.textContent).toContain('Muxus');
  });

  it('shows no in-deck section (and no "Or search" label) when nothing in the deck qualifies', () => {
    renderSheet({ deckCards: [BOLT] });
    expect(screen.queryByRole('region', { name: 'In this deck' })).toBeNull();
    expect(screen.queryByText('Or search')).toBeNull();
    expect(screen.getByTestId('commander-search')).toBeTruthy();
  });

  it('passes a search pick and a My collection pick to onPick, and ignores a cleared value', () => {
    const { onPick } = renderSheet();
    expect(screen.getByTestId('commander-search').dataset.value).toBe('null');
    fireEvent.click(screen.getByRole('button', { name: 'Search clear' }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search pick' }));
    fireEvent.click(screen.getByRole('button', { name: 'Binder pick' }));
    expect(onPick).toHaveBeenNthCalledWith(1, SEARCHED);
    expect(onPick).toHaveBeenNthCalledWith(2, SEARCHED);
  });

  it('closes from its close button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

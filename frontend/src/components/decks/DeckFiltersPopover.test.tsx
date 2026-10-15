// @vitest-environment happy-dom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ColorMatchMode } from '@spellcontrol/binder-routing';
import type { DeckFormat } from '@/deck-builder/types';
import type { DeckSource } from '@/store/decks';
import { DeckFiltersPopover } from './DeckFiltersPopover';

function Harness({ count = 14 }: { count?: number }) {
  const [formats, setFormats] = useState<Set<DeckFormat>>(new Set());
  const [sources, setSources] = useState<Set<DeckSource>>(new Set());
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ColorMatchMode>('all');
  return (
    <>
      <DeckFiltersPopover
        formats={formats}
        setFormats={setFormats}
        sources={sources}
        setSources={setSources}
        colors={colors}
        setColors={setColors}
        colorMode={mode}
        setColorMode={setMode}
        resultCount={count}
      />
      <output data-testid="state">
        {JSON.stringify({ f: [...formats], s: [...sources], c: [...colors], m: mode })}
      </output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}');
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));

describe('DeckFiltersPopover', () => {
  it('heads Format, Source and Color with kit sections that count what is on', () => {
    render(<Harness />);
    openPanel();
    for (const name of ['Format', 'Source', 'Color']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Commander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    expect(screen.getByRole('region', { name: /Format.*1 selected/ })).toBeTruthy();
    expect(state()).toMatchObject({ f: ['commander'], s: ['manual'] });
  });

  it('offers all three color modes, starting on the surface default, and updates the hint', () => {
    render(<Harness />);
    openPanel();
    expect((screen.getByRole('radio', { name: 'Exactly these' }) as HTMLInputElement).checked).toBe(
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(screen.getByText('Only decks whose colors are exactly blue and green.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Within these' }));
    expect(state().m).toBe('within');
    expect(
      screen.getByText('Decks that fit a blue-green deck. Colorless decks included.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Any of these' }));
    expect(state().m).toBe('any');
  });

  it('shows the live result count and clears every filter from the footer', () => {
    render(<Harness count={14} />);
    openPanel();
    expect(screen.getByText('14 decks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(state()).toMatchObject({ f: [], s: [], c: [] });
  });

  it('says so when nothing matches, and uses the singular for one', () => {
    const { rerender } = render(<Harness count={0} />);
    openPanel();
    expect(screen.getByText('No decks match')).toBeTruthy();
    rerender(<Harness count={1} />);
    expect(screen.getByText('1 deck')).toBeTruthy();
  });
});

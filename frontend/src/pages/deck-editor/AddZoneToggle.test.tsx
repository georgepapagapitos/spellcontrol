// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { AddZoneToggle } from './AddZoneToggle';

const names = (container: HTMLElement) =>
  [...container.querySelectorAll('label')].map((l) => l.textContent);

describe('AddZoneToggle', () => {
  it('offers In the box after Considering, for a deck with a sideboard', () => {
    const { container } = render(
      <AddZoneToggle
        addZone="main"
        setAddZone={() => {}}
        formatConfig={DECK_FORMAT_CONFIGS.commander}
      />
    );
    expect(names(container)).toEqual(['Mainboard', 'Sideboard', 'Considering', 'In the box']);
  });

  it('offers In the box even without a format', () => {
    const { container } = render(
      <AddZoneToggle addZone="main" setAddZone={() => {}} formatConfig={null} />
    );
    expect(names(container)).toEqual(['Mainboard', 'Considering', 'In the box']);
  });

  it('picks In the box as one exclusive radio', () => {
    const setAddZone = vi.fn();
    const { getByRole } = render(
      <AddZoneToggle addZone="box" setAddZone={setAddZone} formatConfig={null} />
    );
    expect(getByRole('radio', { name: 'In the box' })).toHaveProperty('checked', true);
    fireEvent.click(getByRole('radio', { name: 'Considering' }));
    expect(setAddZone).toHaveBeenCalledWith('considering');
  });
});

// @vitest-environment happy-dom
/**
 * The merged set picker (board T139): one component now serves the binder
 * rule editor's owned-set options and the collection Filters dialog's every-
 * Scryfall-set options, previously two components (this one and
 * FilterGroupEditor's SetMultiSelect) built from two different option shapes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SetMap } from '../lib/api';
import { SetFilterPicker, setMapToOptions } from './SetFilterPicker';

const OPTIONS = [
  { code: 'CMR', label: 'Commander Legends' },
  { code: 'MH3', label: 'Modern Horizons 3' },
];

describe('SetFilterPicker', () => {
  it('adds a set from the results and shows it as a chip', () => {
    const onChange = vi.fn();
    render(<SetFilterPicker options={OPTIONS} value={new Set()} onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter by set' }));
    fireEvent.mouseDown(screen.getByText('Commander Legends'));
    expect(onChange).toHaveBeenCalledWith(new Set(['CMR']));
  });

  it('excludes already-selected sets from the results and removes via the chip', () => {
    const onChange = vi.fn();
    render(<SetFilterPicker options={OPTIONS} value={new Set(['CMR'])} onChange={onChange} />);
    expect(screen.getByText('CMR')).toBeTruthy();
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter by set' }));
    expect(screen.queryByText('Commander Legends')).toBeNull();
    expect(screen.getByText('Modern Horizons 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Commander Legends' }));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('searches by set code as well as name', () => {
    render(<SetFilterPicker options={OPTIONS} value={new Set()} onChange={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Filter by set' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'mh3' } });
    expect(screen.getByText('Modern Horizons 3')).toBeTruthy();
    expect(screen.queryByText('Commander Legends')).toBeNull();
  });
});

describe('setMapToOptions', () => {
  it('maps a SetMap into picker options, newest release first', () => {
    const setMap: SetMap = {
      CMR: {
        code: 'CMR',
        name: 'Commander Legends',
        iconSvgUri: 'cmr.svg',
        releasedAt: '2020-11-20',
      },
      MH3: {
        code: 'MH3',
        name: 'Modern Horizons 3',
        iconSvgUri: 'mh3.svg',
        releasedAt: '2024-06-14',
      },
    };
    expect(setMapToOptions(setMap).map((o) => o.code)).toEqual(['MH3', 'CMR']);
  });

  it('returns an empty list for an undefined map', () => {
    expect(setMapToOptions(undefined)).toEqual([]);
  });
});

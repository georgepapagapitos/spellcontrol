// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintingPicker } from './PrintingPicker';
import { useScannerSettings } from '../lib/scanner-settings';
import type { ScryfallCard } from '@/deck-builder/types';

const fetchPrintingsMock = vi.fn();
vi.mock('../lib/api', () => ({
  fetchPrintings: (...args: unknown[]) => fetchPrintingsMock(...args),
}));

function printing(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'p1',
    name: 'Dark Ritual',
    set: 'tmc',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    oracle_id: 'o1',
    finishes: ['nonfoil', 'foil'],
    ...overrides,
  } as ScryfallCard;
}

beforeEach(() => {
  useScannerSettings.setState({
    defaultFinish: 'nonfoil',
    defaultCondition: 'nm',
    defaultLanguage: '',
    sound: true,
    showTotal: true,
  });
  fetchPrintingsMock.mockReset();
});

describe('PrintingPicker initial state', () => {
  it('starts from the Add settings defaults', async () => {
    useScannerSettings.setState({
      defaultFinish: 'foil',
      defaultCondition: 'lp',
      defaultLanguage: 'ja',
    });
    const p = printing();
    fetchPrintingsMock.mockResolvedValue([p]);

    render(<PrintingPicker cardName="Dark Ritual" fallback={p} showExtras onAdd={() => {}} />);

    expect((await screen.findByRole('radio', { name: 'Foil' })) as HTMLInputElement).toHaveProperty(
      'checked',
      true
    );
    expect(
      (screen.getByRole('radio', { name: 'Lightly Played' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByRole('button', { name: /^Language/ }).textContent).toContain('Japanese');
  });

  it('clamps the default finish to what the printing actually has', async () => {
    useScannerSettings.setState({ defaultFinish: 'foil' });
    const nonfoilOnly = printing({ id: 'p2', finishes: ['nonfoil'] });
    fetchPrintingsMock.mockResolvedValue([nonfoilOnly]);

    render(<PrintingPicker cardName="Dark Ritual" fallback={nonfoilOnly} onAdd={() => {}} />);

    const nonfoilRadio = (await screen.findByRole('radio', {
      name: 'Non-foil',
    })) as HTMLInputElement;
    expect(nonfoilRadio.checked).toBe(true);
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrintingPicker } from './PrintingPicker';
import { useScannerSettings } from '@/lib/scanner/scanner-settings';
import type { ScryfallCard } from '@/deck-builder/types';

const fetchPrintingsMock = vi.fn();
vi.mock('@/lib/api', () => ({
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

describe('PrintingPicker proxy', () => {
  it('adds as a proxy once the switch is on, and the add bar says so', async () => {
    const p = printing({ prices: { usd: '1649.66' } } as Partial<ScryfallCard>);
    fetchPrintingsMock.mockResolvedValue([p]);
    const onAdd = vi.fn();
    render(<PrintingPicker cardName="Dark Ritual" fallback={p} showExtras onAdd={onAdd} />);

    const sw = await screen.findByRole('switch', { name: 'Proxy' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^Add / }));
    expect(onAdd.mock.calls[0][2]).not.toHaveProperty('proxy');

    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    const add = screen.getByRole('button', { name: /^Add / });
    expect(add.textContent).toContain('Proxy');
    expect(add.textContent).not.toContain('1,649');
    fireEvent.click(add);
    expect(onAdd.mock.calls[1][2]).toMatchObject({ quantity: 1, proxy: true });
  });

  it('has no proxy switch where the add has no per-copy details', async () => {
    const p = printing();
    fetchPrintingsMock.mockResolvedValue([p]);
    render(<PrintingPicker cardName="Dark Ritual" fallback={p} onAdd={() => {}} />);
    await screen.findByRole('radio', { name: 'Non-foil' });
    expect(screen.queryByRole('switch', { name: 'Proxy' })).toBeNull();
  });
});

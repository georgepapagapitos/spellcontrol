import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isVoltronVetoedByName,
  loadVoltronVeto,
  resetVoltronVetoForTests,
  voltronVetoKey,
} from './commander-voltron-veto';

afterEach(() => {
  vi.unstubAllGlobals();
  resetVoltronVetoForTests();
});

describe('commander-voltron-veto', () => {
  it('keys a card by its lowercased front face', () => {
    expect(voltronVetoKey('Gisela, Blade of Goldnight')).toBe('gisela, blade of goldnight');
    expect(voltronVetoKey('Venat, Heart of Hydaelyn // Hydaelyn, the Mothercrystal')).toBe(
      'venat, heart of hydaelyn'
    );
  });

  it('loads the snapshot once and answers by name', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: ['gisela, blade of goldnight'] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const veto = await loadVoltronVeto();
    await loadVoltronVeto();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isVoltronVetoedByName(veto, 'Gisela, Blade of Goldnight')).toBe(true);
    expect(isVoltronVetoedByName(veto, 'Questing Beast')).toBe(false);
    expect(isVoltronVetoedByName(null, 'Gisela, Blade of Goldnight')).toBe(false);
  });

  it('leaves the text deciding when the snapshot cannot load, and tries again next time', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const veto = await loadVoltronVeto();
    expect(veto.size).toBe(0);
    await loadVoltronVeto();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

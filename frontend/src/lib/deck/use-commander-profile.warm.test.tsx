// @vitest-environment happy-dom
/**
 * A deck reopened with its analysis saved never fetches the commander's EDHREC page, so the
 * editor warms it once (no surface cached it) and the profile then drops a vetoed voltron.
 * When the page is already cached there is no request.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  vetoedCard,
  vetoedPage,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';

const fetchCommanderData = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: (name: string) => fetchCommanderData(name),
}));

import { useCommanderProfile, useWarmCommanderPage } from './use-commander-profile';

const isVoltron = (p: ReturnType<typeof useCommanderProfile>) =>
  !!p?.abilities.some((a) => a.keyword === 'voltron');
const editor = (name: string) => {
  const card = vetoedCard(name);
  return renderHook(() => {
    useWarmCommanderPage(card);
    return useCommanderProfile(card);
  });
};

describe('useWarmCommanderPage', () => {
  beforeEach(() => fetchCommanderData.mockReset());

  it('fetches the page once when uncached, then the profile drops voltron', async () => {
    const name = 'Gisela, Blade of Goldnight';
    fetchCommanderData.mockImplementation(async () => {
      await Promise.resolve();
      return vetoedPage(name);
    });
    const { result } = editor(name);
    expect(isVoltron(result.current)).toBe(true);
    await waitFor(() => expect(isVoltron(result.current)).toBe(false));
    expect(fetchCommanderData).toHaveBeenCalledTimes(1);
  });

  it('makes no request when the page is already cached', () => {
    const name = 'Emrakul, the Promised End';
    vetoedPage(name);
    editor(name);
    expect(fetchCommanderData).not.toHaveBeenCalled();
  });

  it('keeps the text reading when the page comes back empty', async () => {
    // Offline, the client answers with an empty page rather than failing.
    fetchCommanderData.mockResolvedValue({ themes: [] });
    const { result } = editor('Maha, Its Feathers Night');
    await waitFor(() => expect(fetchCommanderData).toHaveBeenCalled());
    expect(isVoltron(result.current)).toBe(true);
  });
});

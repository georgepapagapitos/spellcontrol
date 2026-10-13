// @vitest-environment node
/**
 * A deck built from a theme page has no themes on its analysis page (theme pages carry none),
 * so the Voltron veto reads the commander's base page for them: one cached request, best
 * effort, and the text reading when it fails (golden.md R11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EDHRECCommanderData } from '@/deck-builder/types';
import { vetoedCard, vetoedPage } from './__fixtures__/vetoed-commanders';

const fetchCommanderData = vi.fn();
const fetchPartnerCommanderData = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: (...a: unknown[]) => fetchCommanderData(...a),
  fetchPartnerCommanderData: (...a: unknown[]) => fetchPartnerCommanderData(...a),
}));

import { pageThemesFor } from './deckEdhrecSource';
import { buildCommanderProfile } from './commanderProfile';

const themePage = { themes: [], cardlists: {}, stats: {} } as unknown as EDHRECCommanderData;
const isVoltron = (p: ReturnType<typeof buildCommanderProfile>) =>
  p.abilities.some((a) => a.keyword === 'voltron');

describe('pageThemesFor', () => {
  beforeEach(() => {
    fetchCommanderData.mockReset();
    fetchPartnerCommanderData.mockReset();
  });

  it("returns the analysis page's own themes without a request", async () => {
    const gisela = vetoedCard('Gisela, Blade of Goldnight');
    const page = vetoedPage(gisela.name);
    expect(await pageThemesFor(page, gisela, null)).toBe(page.themes);
    expect(fetchCommanderData).not.toHaveBeenCalled();
  });

  it('reads the base page for a theme-page deck, and the veto then applies', async () => {
    const gisela = vetoedCard('Gisela, Blade of Goldnight');
    fetchCommanderData.mockResolvedValue(vetoedPage(gisela.name));
    const edhrecThemes = await pageThemesFor(themePage, gisela, null);
    expect(fetchCommanderData).toHaveBeenCalledWith(gisela.name);
    expect(isVoltron(buildCommanderProfile(gisela, null, { edhrecThemes }))).toBe(false);
  });

  it('falls back to the text reading when the base page cannot be had', async () => {
    const gisela = vetoedCard('Gisela, Blade of Goldnight');
    fetchCommanderData.mockRejectedValue(new Error('offline'));
    const edhrecThemes = await pageThemesFor(themePage, gisela, null);
    expect(edhrecThemes).toBeUndefined();
    expect(isVoltron(buildCommanderProfile(gisela, null, { edhrecThemes }))).toBe(true);
  });
});

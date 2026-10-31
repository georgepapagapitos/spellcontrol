import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTagPageData } from './client';
import page from './__fixtures__/tag-page-aristocrats.fixture.json';

// EDHREC renamed `highsynergycards` to `highliftcards` (hidden gems). The fixture
// is a trimmed live aristocrats tag page: no highsynergycards list, four
// highliftcards (low inclusion, synergy 0.05-0.07), and the type lists.
const TOP_BY_SYNERGY = [
  "Ashnod's Altar",
  'Pitiless Plunderer',
  'Goblin Bombardment',
  'Bastion of Remembrance',
  'Sakura-Tribe Elder',
  'Mayhem Devil',
  'Cauldron of Essence',
  'Warren Soultrader',
  'Deadly Dispute',
  'Phyrexian Altar',
];

describe('high synergy list rebuilt from synergy (E1052)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tag page: highSynergyNames is the top nonland cards by synergy, not empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => page }) as unknown as Response)
    );
    const data = await fetchTagPageData('e1052-aristocrats');
    expect(data?.highSynergyNames).toEqual(TOP_BY_SYNERGY);
  });

  it('still finds the list when EDHREC drops synergy and ships only lift', async () => {
    const liftOnly = structuredClone(page) as typeof page;
    for (const l of liftOnly.container.json_dict.cardlists)
      for (const c of (l.cardviews ?? []) as Array<{ synergy?: number }>) delete c.synergy;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => ({ ok: true, status: 200, json: async () => liftOnly }) as unknown as Response
      )
    );
    const data = await fetchTagPageData('e1052-aristocrats-lift-only');
    // Lift-derived synergy reorders near ties (EDHREC's lift also corrects for
    // spoil dates), so the list is mostly, not exactly, the same cards.
    const names = data?.highSynergyNames ?? [];
    expect(names).toHaveLength(TOP_BY_SYNERGY.length);
    expect(names.filter((n) => TOP_BY_SYNERGY.includes(n)).length).toBeGreaterThanOrEqual(7);
  });

  it('keeps using a real highsynergycards list when EDHREC ships one', async () => {
    const withList = {
      container: {
        json_dict: {
          cardlists: [
            ...page.container.json_dict.cardlists,
            {
              tag: 'highsynergycards',
              cardviews: [{ name: 'Kitchen Finks', sanitized: 'kitchen-finks', num_decks: 227 }],
            },
          ],
        },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => ({ ok: true, status: 200, json: async () => withList }) as unknown as Response
      )
    );
    const data = await fetchTagPageData('e1052-real-list');
    expect(data?.highSynergyNames).toEqual(['Kitchen Finks']);
  });
});

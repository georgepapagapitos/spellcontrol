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

// The commanders the Voltron veto (commander-profile.golden.md R11) exists for: their Oracle
// text reads as a voltron plan, and their EDHREC page says almost nobody builds them that way.
// Real Oracle text and real theme counts, from the golden fixture. Every surface that
// describes a commander is held to the one answer: text-only they read voltron, with the page's
// themes they do not.
import type { ScryfallCard } from '@/deck-builder/types';
import { formatCommanderNameForUrl, parseEdhrecResponse } from '../../edhrec/client';
import golden from './commander-profile.golden.fixture.json';

type Fixture = {
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  edhrecThemes: Record<string, string>;
};
const fx = golden as unknown as Fixture;

/** Each reads voltron from its text alone and is vetoed by its page (checked by the guard test). */
export const VETOED_COMMANDERS = [
  'Gisela, Blade of Goldnight',
  'Emrakul, the Promised End',
  "Gishath, Sun's Avatar",
  'Maha, Its Feathers Night',
  'Valgavoth, Terror Eater',
] as const;

export function vetoedCard(name: string): ScryfallCard {
  return { name, ...fx.cards[name] } as ScryfallCard;
}

/** The page's themes as `panels.taglinks` rows, the shape EDHREC serves them in. */
function taglinks(name: string) {
  return fx.edhrecThemes[name].split(' | ').map((pair) => {
    const at = pair.lastIndexOf(':');
    const value = pair.slice(0, at);
    return {
      value,
      slug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      count: Number(pair.slice(at + 1)),
    };
  });
}

/** What `fetchCommanderData` returns for the commander, parsed (and cached) by the real client. */
export function vetoedPage(name: string) {
  return parseEdhrecResponse(
    { panels: { taglinks: taglinks(name) } } as Parameters<typeof parseEdhrecResponse>[0],
    formatCommanderNameForUrl(name)
  );
}

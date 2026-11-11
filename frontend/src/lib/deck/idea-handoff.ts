import { fetchCommanderThemes } from '@/deck-builder/services/edhrec/client';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import type { DeckFormat, EDHRECTheme, ScryfallCard } from '@/deck-builder/types';
import type { Idea, IdeaSeedContext } from './idea-index';

/** The slice of the generator's `GenerateRouteState` an idea hand-off fills. */
export interface IdeaRouteState {
  prefill: {
    commander: ScryfallCard;
    format: DeckFormat;
    themes?: EDHRECTheme[];
    ideaContext: IdeaSeedContext;
  };
}

/**
 * Hand an idea and one of its commanders to the generator (E1112): the commander is the prefill and
 * the commander's own EDHREC theme of the same slug is preselected. A tag page's deck count for a
 * commander equals that commander's theme count (verified on Giada, Font of Hope: 3982 both
 * ways), so this picks the theme the player is looking at rather than a look-alike. A commander
 * with no such theme builds without one and the generator's banner says so.
 *
 * Throws when the commander card can't be resolved; the caller shows the error and stays put.
 */
export async function buildIdeaRouteState(
  idea: Idea,
  commanderName: string,
  format: DeckFormat
): Promise<IdeaRouteState> {
  const commander = await getCardByName(commanderName);
  const themes = await fetchCommanderThemes(commander.name).catch(() => []);
  const theme = themes.find((t) => t.slug === idea.slug);
  return {
    prefill: {
      commander,
      format,
      ...(theme ? { themes: [theme] } : {}),
      ideaContext: { slug: idea.slug, name: idea.name, kind: idea.kind, themeSelected: !!theme },
    },
  };
}

export const ideaPagePath = (slug: string, format: DeckFormat) =>
  `/decks/new/generate/idea/${slug}?format=${format}`;

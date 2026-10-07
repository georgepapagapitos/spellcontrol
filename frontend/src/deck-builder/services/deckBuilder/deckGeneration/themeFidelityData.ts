// The I/O half of theme fidelity (E574): read each selected theme's EDHREC page
// (and, for the live harness, its average deck) into the ThemePage shape the
// pure measure in ../themeFidelity.ts takes. The theme pages are the ones the
// build already fetched, so these reads are cache hits; the average deck is a
// fresh request, which is why only the harness asks for it.
import type {
  BudgetOption,
  DeckDataSource,
  EDHRECCommanderData,
  ScryfallCard,
  TargetBracket,
  ThemeResult,
} from '@/deck-builder/types';
import {
  fetchAverageDeckSpells,
  fetchCommanderThemeData,
  fetchPartnerThemeData,
} from '@/deck-builder/services/edhrec/client';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { normalizeCardName } from '../cardIdentity';
import {
  measureThemeFidelity,
  themeTribe,
  type ThemeCard,
  type ThemeFidelity,
  type ThemePage,
} from '../themeFidelity';

export interface ThemePageRequest {
  themes: readonly ThemeResult[];
  commanderName: string;
  partnerName?: string;
  budgetOption?: BudgetOption;
  targetBracket?: TargetBracket;
  /** Also read each theme's average deck (one more request per theme). */
  withAverageDeck?: boolean;
}

function pageSynergy(data: EDHRECCommanderData): Map<string, number> {
  const out = new Map<string, number>();
  for (const card of data.cardlists.allNonLand) {
    const key = normalizeCardName(frontFaceName(card.name));
    out.set(key, Math.max(out.get(key) ?? -Infinity, card.synergy ?? 0));
  }
  return out;
}

async function averageDeck(
  req: ThemePageRequest,
  slug: string
): Promise<readonly ThemeCard[] | undefined> {
  const avg = await fetchAverageDeckSpells(
    [req.commanderName, ...(req.partnerName ? [req.partnerName] : [])],
    { themeSlug: slug, targetBracket: req.targetBracket, budgetOption: req.budgetOption }
  );
  // A broader page's average deck says nothing about THIS theme.
  if (!avg || avg.page !== 'theme') return undefined;
  const resolved = await getCardsByNames(avg.names);
  const cards: ScryfallCard[] = [];
  for (const name of avg.names) {
    const card = resolved.get(name);
    if (card) cards.push(card);
  }
  return cards.length >= 20 ? cards : undefined;
}

/**
 * The selected themes as ThemePages. A theme whose page cannot be read is
 * dropped, so a fetch failure shrinks the measure instead of failing the build.
 */
export async function loadThemePages(req: ThemePageRequest): Promise<ThemePage[]> {
  const slugged = req.themes.filter((t) => t.isSelected && t.source === 'edhrec' && t.slug);
  const pages = await Promise.all(
    slugged.map(async (theme): Promise<ThemePage | null> => {
      try {
        const data = await (req.partnerName
          ? fetchPartnerThemeData(
              req.commanderName,
              req.partnerName,
              theme.slug!,
              req.budgetOption,
              req.targetBracket
            )
          : fetchCommanderThemeData(
              req.commanderName,
              theme.slug!,
              req.budgetOption,
              req.targetBracket
            ));
        return {
          name: theme.name,
          tribe: themeTribe(theme.name),
          synergy: pageSynergy(data),
          averageDeck: req.withAverageDeck ? await averageDeck(req, theme.slug!) : undefined,
        };
      } catch {
        return null;
      }
    })
  );
  return pages.filter((p): p is ThemePage => p !== null);
}

/**
 * The shipped deck's theme fidelity (the build report writes its line). Empty unless the
 * deck was built from theme pages: a deck that fell back to the commander's base
 * page, or has no theme, has no theme to be faithful to (the pool-fallback note
 * already says why).
 */
export async function deckThemeFidelity(
  req: ThemePageRequest & { dataSource: DeckDataSource | undefined },
  nonlandCards: readonly ThemeCard[]
): Promise<{ themeFidelity?: ThemeFidelity }> {
  if (req.dataSource !== 'theme' && req.dataSource !== 'theme+bracket') return {};
  const pages = await loadThemePages({
    ...req,
    // The ladder's 'theme' rung is the page without the bracket filter.
    targetBracket: req.dataSource === 'theme+bracket' ? req.targetBracket : undefined,
  });
  const themeFidelity = measureThemeFidelity(nonlandCards, pages);
  if (!themeFidelity) return {};
  return { themeFidelity };
}

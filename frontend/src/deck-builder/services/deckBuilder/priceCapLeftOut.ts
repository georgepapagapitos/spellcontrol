/**
 * E1032: a max card price is the user's call, so the generator honors it even
 * for the staple rocks (Sol Ring, Arcane Signet, Command Tower). It never said
 * so: a Rin and Seri build at a $1 cap shipped without Sol Ring ($1.42, owned,
 * in 91% of decks) and no note. This names the high-inclusion cards the cap
 * kept out, with their price, so the user can raise the cap or add the card.
 *
 * Read-only over the FINAL deck: it decides nothing and seats nothing.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { getCachedCard, getCardPrice } from '@/deck-builder/services/scryfall/client';
import {
  constrainsToCollection,
  exceedsCmcCap,
  exceedsMaxRarity,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notInCollection,
  notLegalForFormat,
  notOnArena,
} from './deckFilters';
import { STAPLE_ROCKS } from './deckGeneration/phaseStapleManaRocks';
import type { GenerationState } from './deckGeneration/state';

/** A page card is named only when it is a staple (40%+ of decks), as in the unowned note. */
const LEFT_OUT_MIN_INCLUSION = 40;
const LEFT_OUT_NAMED = 5;

export interface PriceCapLeftOut {
  name: string;
  price: number;
  /** EDHREC inclusion on this commander's page; undefined when the page lacks the card. */
  inclusion?: number;
  /** A named staple (the rocks, Command Tower): named before any page card. */
  staple: boolean;
}

/** The named staples this deck would run: the rocks by color count, plus Command Tower at 2+ colors. */
function namedStaples(colorCount: number): string[] {
  const rocks = STAPLE_ROCKS.filter((s) => colorCount >= s.minColors).map((s) => s.name);
  return colorCount >= 2 ? [...rocks, 'Command Tower'] : rocks;
}

/**
 * The cards the max card price kept out of the final deck: the named staples
 * and every page card at 40%+ inclusion, priced over the cap, that nothing
 * else ruled out (in the deck, banned, unowned in an owned-only build, owned
 * and exempt from the cap, or failing another cap the user set). A card with
 * no price is skipped: the note can't say what it costs.
 */
export function findPriceCapLeftOut(
  state: GenerationState,
  poolCards: ReadonlyMap<string, ScryfallCard>,
  inDeck: (name: string) => boolean
): PriceCapLeftOut[] {
  const { cfg } = state;
  const cap = cfg.maxCardPrice;
  if (cap === null) return [];
  const collection = state.context.collectionNames;

  const inclusion = new Map<string, number>();
  const lists = state.edhrecData?.cardlists;
  for (const c of [...(lists?.allNonLand ?? []), ...(lists?.lands ?? [])]) {
    inclusion.set(c.name, Math.max(inclusion.get(c.name) ?? 0, c.inclusion));
  }
  const staples = new Set(
    cfg.format === 99 ? namedStaples(state.context.colorIdentity.length) : []
  );
  const names = new Set(staples);
  for (const [name, pct] of inclusion) if (pct >= LEFT_OUT_MIN_INCLUSION) names.add(name);

  const rows: PriceCapLeftOut[] = [];
  for (const name of names) {
    if (inDeck(name) || state.bannedCards.has(name)) continue;
    if (constrainsToCollection(cfg.collectionStrategy) && notInCollection(name, collection))
      continue;
    if (isOwnedBudgetExempt(name, collection, cfg.ignoreOwnedBudget)) continue;
    const card =
      state.priceCappedStaples?.get(name) ??
      poolCards.get(name) ??
      getCachedCard(name, cfg.arenaOnly);
    if (!card) continue;
    const price = parseFloat(getCardPrice(card, cfg.currency) ?? '');
    if (!Number.isFinite(price) || price <= cap) continue;
    // Raising the cap would not seat a card another setting rules out.
    if (notLegalForFormat(card, cfg.mtgFormat) || notOnArena(card, cfg.arenaOnly)) continue;
    if (exceedsCmcCap(card, cfg.maxCmc)) continue;
    if (
      !isOwnedRarityExempt(name, collection, cfg.ignoreOwnedRarity) &&
      exceedsMaxRarity(card, cfg.maxRarity)
    )
      continue;
    rows.push({ name, price, inclusion: inclusion.get(name), staple: staples.has(name) });
  }
  return rows.sort(
    (a, b) => Number(b.staple) - Number(a.staple) || (b.inclusion ?? 0) - (a.inclusion ?? 0)
  );
}

/** The disclosure line, or undefined when the cap kept nothing out. */
export function buildPriceCapLeftOutNote(
  rows: readonly PriceCapLeftOut[],
  cap: number | null,
  currency: 'USD' | 'EUR' = 'USD'
): string | undefined {
  if (cap === null || rows.length === 0) return undefined;
  const sym = currency === 'EUR' ? '€' : '$';
  const money = (n: number) => `${sym}${n.toFixed(2)}`;
  const named = rows
    .slice(0, LEFT_OUT_NAMED)
    .map((r) =>
      r.inclusion === undefined
        ? `${r.name} (${money(r.price)})`
        : `${r.name} (${money(r.price)}, ${Math.round(r.inclusion)}%)`
    )
    .join(', ');
  const more = rows.length - LEFT_OUT_NAMED;
  const tail = more > 0 ? `, and ${more} more played in ${LEFT_OUT_MIN_INCLUSION}%+ of decks` : '';
  const one = rows.length === 1;
  return (
    `Left out because ${one ? 'it costs' : 'they cost'} more than your ${money(cap)} max card price: ` +
    `${named}${tail}. Raise the cap or add ${one ? 'it' : 'them'} by hand.`
  );
}

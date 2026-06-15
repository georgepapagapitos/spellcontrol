/**
 * Pure mana/composition computation for a deck — curve, average CMC, color
 * demand vs. production, type breakdown, and the per-bucket card drill-downs.
 *
 * Lifted verbatim from DeckDisplay.tsx (the averageCmc / manaCurve / colorDist /
 * manaProduction / typeBreakdown / drill-down useMemos plus its private
 * classifyType + tallyNames helpers) so DeckDisplay can delegate to it AND the
 * deck-compare page can render the exact same numbers. Keeping one
 * implementation is the whole point — the compare view must agree with the deck
 * editor for the same deck. Pure: depends only on the card array + commanders.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardTally } from '@/components/deck/useCardCarousel';
import type { DeckManaData } from '@/components/deck/deck-mana-types';
import { producedManaColors, isManaSourceType, deckColorIdentity } from '@/lib/mana-sources';

export type { DeckManaData };

// Type classification — first matching group wins; default Artifact mirrors the
// deck editor. Order matters (e.g. "Artifact Creature" → Creature).
const CLASSIFY_PRIORITY = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Sorcery',
  'Instant',
  'Artifact',
  'Enchantment',
] as const;
export type TypeGroup = (typeof CLASSIFY_PRIORITY)[number];

function classifyType(card: ScryfallCard): TypeGroup {
  const tl = (card.type_line || '').toLowerCase();
  for (const group of CLASSIFY_PRIORITY) {
    if (tl.includes(group.toLowerCase())) return group;
  }
  return 'Artifact';
}

/** Collapse a list of cards to unique name → copy count (keeping one
 *  representative card object so the drill-down carousel renders without
 *  re-fetching), sorted by count desc then name. */
function tallyNames(cards: ScryfallCard[]): CardTally[] {
  const m = new Map<string, { count: number; card: ScryfallCard }>();
  for (const c of cards) {
    const e = m.get(c.name);
    if (e) e.count += 1;
    else m.set(c.name, { count: 1, card: c });
  }
  return [...m.entries()]
    .map(([name, { count, card }]) => ({ name, count, card }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const isLand = (card: ScryfallCard) => (card.type_line || '').toLowerCase().includes('land');

/**
 * Build a deck's full mana/composition data from its flat card list.
 *
 * `allCards` is every card incl. commander(s) (the same flat array DeckDisplay
 * uses); `commander`/`partnerCommander` are passed separately so mana-source
 * production can be clamped to the deck's color identity (Command Tower etc.).
 */
export function buildManaData(
  allCards: ScryfallCard[],
  commander: ScryfallCard | null,
  partnerCommander?: ScryfallCard | null
): DeckManaData {
  // Curve + average CMC (nonland only).
  const manaCurve: Record<number, number> = {};
  const nonLand = allCards.filter((c) => !isLand(c));
  for (const c of nonLand) {
    const cmc = Math.min(7, Math.round(c.cmc ?? 0));
    manaCurve[cmc] = (manaCurve[cmc] ?? 0) + 1;
  }
  const averageCmc =
    nonLand.length === 0 ? 0 : nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length;

  // Color demand — nonland cards counted per color in their identity.
  const colorCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let colorTotal = 0;
  for (const c of nonLand) {
    const ci = c.color_identity ?? [];
    if (ci.length === 0) {
      colorCounts.C += 1;
      colorTotal += 1;
      continue;
    }
    for (const k of ci) {
      colorCounts[k] = (colorCounts[k] ?? 0) + 1;
      colorTotal += 1;
    }
  }
  const colorDist = { counts: colorCounts, total: colorTotal };

  // Mana production — only permanents that make mana (lands/rocks/dorks),
  // clamped to the deck's color identity.
  const prodCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sources: Record<string, ScryfallCard[]> = { W: [], U: [], B: [], R: [], G: [], C: [] };
  const identity = deckColorIdentity(allCards, [commander, partnerCommander]);
  let totalSources = 0;
  for (const c of allCards) {
    if (!isManaSourceType(c)) continue;
    const colors = producedManaColors(c, identity);
    if (colors.length === 0) continue;
    totalSources += 1;
    for (const k of colors) {
      prodCounts[k] = (prodCounts[k] ?? 0) + 1;
      (sources[k] ??= []).push(c);
    }
  }
  const sourcesByColor = Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [k, tallyNames(v)])
  );
  const manaProduction = { counts: prodCounts, total: totalSources, sourcesByColor };

  // Type breakdown (spans every card).
  const typeBreakdown: Record<TypeGroup, number> = {
    Land: 0,
    Creature: 0,
    Planeswalker: 0,
    Battle: 0,
    Sorcery: 0,
    Instant: 0,
    Artifact: 0,
    Enchantment: 0,
  };
  for (const c of allCards) typeBreakdown[classifyType(c)] += 1;

  // Per-bucket card lists powering the drill-down carousels. Curve/color exclude
  // lands + bucket at 7+ like the counts above; types span every card.
  const byCmc: Record<number, ScryfallCard[]> = {};
  const byType: Record<string, ScryfallCard[]> = {};
  const byColor: Record<string, ScryfallCard[]> = {};
  for (const c of allCards) {
    if (!isLand(c)) {
      const cmc = Math.min(7, Math.round(c.cmc ?? 0));
      (byCmc[cmc] ??= []).push(c);
      const ci = c.color_identity ?? [];
      if (ci.length === 0) (byColor.C ??= []).push(c);
      else for (const k of ci) (byColor[k] ??= []).push(c);
    }
    (byType[classifyType(c)] ??= []).push(c);
  }
  const tally = (m: Record<string | number, ScryfallCard[]>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, tallyNames(v)]));

  return {
    manaCurve,
    averageCmc,
    colorDist,
    manaProduction,
    typeBreakdown,
    cardsByCmc: tally(byCmc) as Record<number, CardTally[]>,
    cardsByType: tally(byType),
    cardsByColor: tally(byColor),
  };
}

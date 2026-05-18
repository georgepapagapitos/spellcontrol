import type { EDHRECCard, ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import {
  getFrontFaceTypeLine,
  isChannelLand,
  isMdfcLand,
} from '@/deck-builder/services/scryfall/client';
import { scoreRecommendation, type ScoringContext } from '../deckAnalyzer';
import { BASIC_LAND_NAMES, CHANNEL_LAND_BOOST, MDFC_LAND_BOOST } from '../landGenerator';
import type { GenerationState } from './state';

// Build per-card relevancy scores (composite: synergy + inclusion + role
// deficit + curve fit + type balance). Verbatim extraction from generateDeck:
// state containers rewritten to state.X (categories, currentRoleCounts,
// currentSubtypeCounts, staticComboBoosts); roleTargets/curveTargets/
// typeTargets/swapCandidates/gapAnalysis passed in (generateDeck locals).
export function cardRelevancyPhase(
  state: GenerationState,
  roleTargets: Record<RoleKey, number> | null,
  curveTargets: Record<number, number>,
  typeTargets: Record<string, number>,
  swapCandidates: Record<string, ScryfallCard[]> | undefined,
  gapAnalysis: GapAnalysisCard[] | undefined
): Record<string, number> | undefined {
  let cardRelevancyMap: Record<string, number> | undefined;
  if (state.edhrecData) {
    // Index full EDHREC card objects for synergy/theme lookup
    const edhrecCardIndex = new Map<string, EDHRECCard>();
    for (const c of state.edhrecData.cardlists.allNonLand) edhrecCardIndex.set(c.name, c);
    for (const c of state.edhrecData.cardlists.lands) {
      if (!BASIC_LAND_NAMES.has(c.name)) edhrecCardIndex.set(c.name, c);
    }

    // Build scoring context from final deck state
    const relRoleDeficits = roleTargets
      ? Object.entries(roleTargets).map(([role, target]) => ({
          role,
          label: role,
          current: state.currentRoleCounts[role as RoleKey] ?? 0,
          target,
          deficit: Math.max(0, target - (state.currentRoleCounts[role as RoleKey] ?? 0)),
        }))
      : [];

    const nonLandForScoring = Object.values(state.categories)
      .flat()
      .filter(
        (c) =>
          !BASIC_LAND_NAMES.has(c.name) && !getFrontFaceTypeLine(c).toLowerCase().includes('land')
      );
    const actualCurve: Record<number, number> = {};
    for (const c of nonLandForScoring) {
      const cmc = Math.min(Math.floor(c.cmc), 7);
      actualCurve[cmc] = (actualCurve[cmc] || 0) + 1;
    }
    const relCurveAnalysis = Object.keys(curveTargets)
      .map(Number)
      .map((cmc) => ({
        cmc,
        current: actualCurve[cmc] || 0,
        target: curveTargets[cmc] || 0,
        delta: (actualCurve[cmc] || 0) - (curveTargets[cmc] || 0),
      }));

    const actualTypes: Record<string, number> = {};
    for (const c of nonLandForScoring) {
      const t = getFrontFaceTypeLine(c).toLowerCase();
      const type =
        ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'].find((tp) =>
          t.includes(tp)
        ) || 'other';
      actualTypes[type] = (actualTypes[type] || 0) + 1;
    }
    const relTypeAnalysis = Object.keys(typeTargets).map((type) => ({
      type,
      current: actualTypes[type] || 0,
      target: typeTargets[type] || 0,
      delta: (actualTypes[type] || 0) - (typeTargets[type] || 0),
    }));

    const scoringCtx: ScoringContext = {
      roleDeficits: relRoleDeficits,
      curveAnalysis: relCurveAnalysis,
      typeAnalysis: relTypeAnalysis,
      currentSubtypeCounts: state.currentSubtypeCounts,
    };

    const relMap: Record<string, number> = {};
    for (const cards of Object.values(state.categories)) {
      for (const card of cards) {
        if (BASIC_LAND_NAMES.has(card.name)) continue;
        const ec =
          edhrecCardIndex.get(card.name) ??
          (card.name.includes(' // ')
            ? edhrecCardIndex.get(card.name.split(' // ')[0])
            : undefined);
        if (!ec) {
          relMap[card.name] = 0;
          continue;
        }
        const role = (card.deckRole as RoleKey) || null;
        const sub =
          card.rampSubtype ||
          card.removalSubtype ||
          card.boardwipeSubtype ||
          card.cardDrawSubtype ||
          null;
        let score = scoreRecommendation(ec, role, sub, scoringCtx);
        // Apply the same boosts used during card selection so the displayed
        // relevancy score reflects why the generator actually picked this card
        score += state.staticComboBoosts.get(card.name) ?? 0;
        if (isChannelLand(card)) score += CHANNEL_LAND_BOOST;
        else if (card.isMdfcLand || isMdfcLand(card)) score += MDFC_LAND_BOOST;
        relMap[card.name] = Math.round(score);
      }
    }
    // Also index swap candidates
    if (swapCandidates) {
      for (const cards of Object.values(swapCandidates)) {
        for (const card of cards) {
          if (relMap[card.name] !== undefined) continue;
          const ec =
            edhrecCardIndex.get(card.name) ??
            (card.name.includes(' // ')
              ? edhrecCardIndex.get(card.name.split(' // ')[0])
              : undefined);
          if (!ec) continue;
          const role = (card.deckRole as RoleKey) || null;
          const sub =
            card.rampSubtype ||
            card.removalSubtype ||
            card.boardwipeSubtype ||
            card.cardDrawSubtype ||
            null;
          let score = scoreRecommendation(ec, role, sub, scoringCtx);
          score += state.staticComboBoosts.get(card.name) ?? 0;
          if (isChannelLand(card)) score += CHANNEL_LAND_BOOST;
          else if (card.isMdfcLand || isMdfcLand(card)) score += MDFC_LAND_BOOST;
          relMap[card.name] = Math.round(score);
        }
      }
    }
    // Also index gap analysis cards
    if (gapAnalysis) {
      for (const g of gapAnalysis) {
        if (relMap[g.name] !== undefined) continue;
        const pseudoEc: EDHRECCard = {
          name: g.name,
          sanitized: g.name,
          primary_type:
            g.typeLine
              .split(' ')
              .find((t) =>
                [
                  'Creature',
                  'Instant',
                  'Sorcery',
                  'Artifact',
                  'Enchantment',
                  'Planeswalker',
                  'Land',
                ].includes(t)
              ) || 'Unknown',
          inclusion: g.inclusion,
          num_decks: 0,
          synergy: g.synergy,
          cmc: g.cmc,
        };
        const role = (g.role as RoleKey) || null;
        relMap[g.name] = Math.round(scoreRecommendation(pseudoEc, role, null, scoringCtx));
      }
    }
    cardRelevancyMap = relMap;
    console.log(`[DeckGen] Relevancy map: ${Object.keys(relMap).length} cards scored`);
  }

  return cardRelevancyMap;
}

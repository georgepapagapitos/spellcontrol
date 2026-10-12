import { useMemo } from 'react';
import type { DeckFormatConfig, ScryfallCard } from '@/deck-builder/types';
import { buildManaData } from '@/lib/deck-analysis/build-mana-data';
import { sideboardLimit } from '@/lib/deck/deck-validation';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  buildValidationChecklist,
  summarizeValidation,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import {
  deriveDeckIdentity,
  resolveAutoArchetype,
} from '@/deck-builder/services/deckBuilder/deckIdentity';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { useProducedMana } from './use-produced-mana';
import { buildSynergyByName } from './deck-display-derive';
import type { DeckDisplayCard, DeckDisplayProps } from './deck-display-types';

interface Args {
  cards: DeckDisplayCard[];
  sideboardCount: number;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
  formatConfig: DeckFormatConfig;
  illegalCardNames: string[];
  taggerReady: boolean;
  selectedThemes: DeckDisplayProps['selectedThemes'];
  archetypeOverride: DeckDisplayProps['archetypeOverride'];
  buildReport: DeckDisplayProps['buildReport'];
  roleCounts: DeckDisplayProps['roleCounts'];
  roleTargets: DeckDisplayProps['roleTargets'];
  rampSubtypeCounts: DeckDisplayProps['rampSubtypeCounts'];
  removalSubtypeCounts: DeckDisplayProps['removalSubtypeCounts'];
  boardwipeSubtypeCounts: DeckDisplayProps['boardwipeSubtypeCounts'];
  cardDrawSubtypeCounts: DeckDisplayProps['cardDrawSubtypeCounts'];
}

/**
 * Everything the deck view derives from its card list: the flat card list,
 * the commander profile and deck identity, per-card synergy reasons, mana
 * data, the live role counts and the pass/fail health checklist.
 */
export function useDeckAnalysis({
  cards,
  sideboardCount,
  commander,
  partnerCommander,
  formatConfig,
  illegalCardNames,
  taggerReady,
  selectedThemes,
  archetypeOverride,
  buildReport,
  roleCounts,
  roleTargets,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
}: Args) {
  // Flat list for stats panels (commanders included, since color identity
  // and curve are commander-relevant too).
  const allCards = useMemo<ScryfallCard[]>(() => {
    const list: ScryfallCard[] = [];
    if (commander) list.push(commander);
    if (partnerCommander) list.push(partnerCommander);
    for (const dc of cards) list.push(dc.card);
    return list;
  }, [commander, partnerCommander, cards]);

  // The deck's own copies by name, so the bracket tiles show its art and
  // printing. Built here from the cards every caller already passes: the
  // shared deck page once left it out and its tiles came up blank.
  const deckCardsByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    for (const c of allCards) if (!m.has(c.name)) m.set(c.name, c);
    return m;
  }, [allCards]);

  // The deck's legal color identity = the commander(s)' combined identity.
  // Undefined when there's no commander, which skips the identity validation gate.
  const commanderIdentity = useMemo<string[] | undefined>(() => {
    if (!commander) return undefined;
    const set = new Set<string>();
    for (const c of [commander, partnerCommander]) {
      for (const k of c?.color_identity ?? []) set.add(k);
    }
    return [...set];
  }, [commander, partnerCommander]);

  // The commander's parsed ability profile — shared by the per-card synergy
  // reasons and the deck-identity strip.
  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander, partnerCommander) : null),
    [commander, partnerCommander]
  );

  // Live-computed deck identity (archetype + pacing + themes). On Auto the
  // archetype follows the deck's own engine when one clearly leads, the same
  // engine the Power tab and the playstyle radar read (`resolveAutoArchetype`
  // has the precedence), so the strip can't say Goodstuff while Power says
  // Voltron. The engine is pure oracle-text work over the list, so it is
  // ready on first paint with no flash from one label to another.
  const deckEngine = useMemo(() => analyzeDeckSynergy(allCards), [allCards]);
  const identity = useMemo(
    () =>
      commanderProfile
        ? deriveDeckIdentity({
            profile: commanderProfile,
            selectedThemes,
            cards: allCards,
            persistedArchetype: resolveAutoArchetype({
              override: archetypeOverride,
              build: buildReport,
              engine: deckEngine,
            }),
          })
        : null,
    [commanderProfile, selectedThemes, allCards, buildReport, archetypeOverride, deckEngine]
  );

  // "Why this card" synergy reasons, keyed by card name.
  const synergyByName = useMemo<Map<string, string[]>>(
    () => buildSynergyByName(commanderProfile, cards),
    [commanderProfile, cards]
  );

  // Mana curve / color demand+production / type breakdown / drill-downs — the
  // shared pure builder so this view and the deck-compare page agree exactly.
  // Deck rows store each card as the cache had it when the card was added, so a
  // deck built before #2011 carries no `produced_mana` at all and the analysis
  // falls back to oracle text — which never reads `{C}`. Backfill it first.
  const manaCards = useProducedMana(allCards);
  const manaData = useMemo(
    () => buildManaData(manaCards, commander, partnerCommander),
    [manaCards, commander, partnerCommander]
  );

  // One count per role for everything on this page that shows one: the role
  // chips, the Roles panel and the deck checks. Live from the mainboard, each
  // card under its one counted role (`countedRoleOf`), commander excluded, the
  // same count the generator, the analysis and the AI's check_bracket use. A
  // generated deck's stored `roleCounts` is a snapshot from generation time;
  // it only stands in until the tagger loads, then the live count takes over,
  // so an edit moves every number together.
  const liveRoles = useMemo(
    () => (taggerReady ? computeRoleCounts(cards.map((dc) => dc.card)) : null),
    [cards, taggerReady]
  );
  const shownRoles = liveRoles ?? {
    roleCounts,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
  };

  // Pass/fail deck-health checklist for the Stats board — legality gates plus
  // the soft role/curve targets, derived from the live list + role analysis.
  // Lives here rather than in DeckAnalysisView so the Deck view can report the
  // same verdict upward (E223's tab badge) without a second, drifting
  // computation.
  const sideboardCap = sideboardLimit(formatConfig);
  const validation = useMemo(
    () =>
      buildValidationChecklist({
        cards: allCards,
        commanderIdentity,
        roleCounts: shownRoles.roleCounts,
        roleTargets,
        averageCmc: manaData.averageCmc,
        format: formatConfig,
        illegalCardNames,
        sideboard:
          sideboardCap === null ? undefined : { count: sideboardCount, limit: sideboardCap },
      }),
    [
      allCards,
      commanderIdentity,
      shownRoles.roleCounts,
      roleTargets,
      manaData.averageCmc,
      formatConfig,
      illegalCardNames,
      sideboardCap,
      sideboardCount,
    ]
  );
  const health = useMemo(() => summarizeValidation(validation), [validation]);

  return {
    allCards,
    deckCardsByName,
    identity,
    synergyByName,
    manaCards,
    manaData,
    liveRoles,
    shownRoles,
    validation,
    health,
  };
}

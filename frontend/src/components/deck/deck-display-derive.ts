// Pure derivations behind DeckDisplay's useMemos: the bodies moved out
// verbatim so the component keeps only the hook wrappers and their deps.
// No React, no I/O. Split out of DeckDisplay.tsx (T176, W5).
import type { ScryfallCard, DeckFormatConfig } from '@/deck-builder/types';
import type { DeckCard, DeckZone } from '../../store/decks';
import type { EnrichedCard } from '../../types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import {
  whyCardMatches,
  type CommanderProfile,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import { tallyNames } from '@/lib/deck-analysis/build-mana-data';
import {
  buildAllocationMap,
  classifyAllocation,
  type AllocationInfo,
  type AllocationStatus,
} from '@/lib/collection/allocations';
import {
  validateDeckZones,
  COMMANDER_SLOT_ID,
  PARTNER_COMMANDER_SLOT_ID,
} from '@/lib/deck/deck-validation';
import type { BinderInfo } from '../BinderBadge';
import type { DeckCardInspectorCard } from './DeckCardInspector';
import type { DeckDisplayCard } from './deck-display-types';
import type { ComboMatch } from '@/types/combos';
import {
  resolveInclusionPct,
  priceOf,
  frontFaceImage,
  backFaceImage,
  frontFaceImageLarge,
  backFaceImageLarge,
  colorKeyOf,
  type CurrencyCode,
  type Row,
  type CrossDeckCtx,
  type TypedGroup,
} from './deck-display-rows';

/** The collapsed-section keys under one prefix, with the prefix stripped. */
export function titlesUnder(keys: Set<string>, prefix: string): Set<string> {
  return new Set([...keys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

export function buildCrossDeckCtx(
  collectionByCopyId: Map<string, EnrichedCard> | undefined,
  allDecks: Parameters<typeof buildAllocationMap>[0],
  savedCubes: Parameters<typeof buildAllocationMap>[1],
  deckId: string | undefined
): CrossDeckCtx {
  if (!collectionByCopyId) return {};
  const copiesByName = new Map<string, EnrichedCard[]>();
  for (const copy of collectionByCopyId.values()) {
    const key = copy.name.toLowerCase();
    const list = copiesByName.get(key);
    if (list) list.push(copy);
    else copiesByName.set(key, [copy]);
  }
  const others = deckId ? allDecks.filter((d) => d.id !== deckId) : allDecks;
  // Physical cubes are always "other" (a cube is never the deck being viewed),
  // so a copy committed to a cube reads as claimed-elsewhere here too.
  const otherDeckAllocations = buildAllocationMap(others, savedCubes);
  return { copiesByName, otherDeckAllocations };
}

export function buildCommanderRows(args: {
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
  commanderAllocatedCopyId: string | null | undefined;
  partnerCommanderAllocatedCopyId: string | null | undefined;
  collectionByCopyId: Map<string, EnrichedCard> | undefined;
  crossDeck: CrossDeckCtx;
  claimedByForName: (cardName: string) => Row['claimedBy'];
  currency: CurrencyCode;
}): Row[] {
  const {
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
    crossDeck,
    claimedByForName,
    currency,
  } = args;
  const rows: Row[] = [];
  const push = (c: ScryfallCard, allocatedCopyId?: string | null, isPartner = false) => {
    const owned = allocatedCopyId ? collectionByCopyId?.get(allocatedCopyId) : undefined;
    const status: AllocationStatus = classifyAllocation(
      allocatedCopyId ?? null,
      collectionByCopyId,
      {
        cardName: c.name,
        copiesByName: crossDeck.copiesByName,
        allocations: crossDeck.otherDeckAllocations,
      }
    );
    rows.push({
      name: c.name,
      qty: 1,
      card: c,
      printings: [],
      cmc: c.cmc ?? 0,
      price: priceOf(c, currency),
      colorKey: colorKeyOf(c),
      addedAt: 0,
      slotIds: [],
      allocatedCopyIds: allocatedCopyId ? [allocatedCopyId] : [],
      status,
      allocatedQty: status === 'allocated' ? 1 : 0,
      unownedQty: status === 'unowned' ? 1 : 0,
      orphanQty: status === 'orphan' ? 1 : 0,
      claimedElsewhereQty: status === 'claimed-elsewhere' ? 1 : 0,
      claimedBy: status === 'claimed-elsewhere' ? claimedByForName(c.name) : undefined,
      imageNormal: owned?.imageNormal ?? frontFaceImage(c),
      imageNormalBack: owned?.imageNormalBack ?? backFaceImage(c),
      imageLarge: owned?.imageLarge ?? frontFaceImageLarge(c),
      imageLargeBack: owned?.imageLargeBack ?? backFaceImageLarge(c),
      foil: owned?.foil ?? false,
      finish: owned?.finish ?? 'nonfoil',
      finishes: owned?.finishes,
      promoTypes: owned?.promoTypes,
      frameEffects: owned?.frameEffects,
      setCode: owned?.setCode || c.set || '',
      setName: owned?.setName || c.set_name,
      collectorNumber: owned?.collectorNumber || c.collector_number || '',
      isPartner,
      legalitySlotKey: isPartner ? PARTNER_COMMANDER_SLOT_ID : COMMANDER_SLOT_ID,
      // Commanders have no deck slot to tag (E171 is a mainboard/side/
      // considering concept) — always untouched/untagged.
      tags: [],
      tagsEdited: false,
    });
  };
  if (commander) push(commander, commanderAllocatedCopyId);
  if (partnerCommander) push(partnerCommander, partnerCommanderAllocatedCopyId, true);
  return rows;
}

/** Deck-slot shape the validators want, from the display cards. */
export function toDeckCards(list: DeckDisplayCard[]): DeckCard[] {
  return list.map((c) => ({
    slotId: c.slotId ?? '',
    card: c.card,
    allocatedCopyId: c.allocatedCopyId ?? null,
  }));
}

export function validateDisplayedZones(args: {
  cards: DeckDisplayCard[];
  sideboard: DeckDisplayCard[];
  formatConfig: DeckFormatConfig;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
  bannedNames: ReadonlySet<string> | null;
}) {
  const { cards, sideboard, formatConfig, commander, partnerCommander, bannedNames } = args;
  const mainDeckCards = toDeckCards(cards);
  const sideDeckCards = toDeckCards(sideboard);
  return validateDeckZones(mainDeckCards, sideDeckCards, formatConfig, {
    commander,
    partnerCommander: partnerCommander ?? null,
    bannedNames: bannedNames ?? undefined,
  });
}

/** "Why this card" synergy reasons, keyed by card name. */
export function buildSynergyByName(
  commanderProfile: CommanderProfile | null,
  cards: DeckDisplayCard[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!commanderProfile || commanderProfile.abilities.length === 0) return map;
  for (const dc of cards) {
    const card = dc.card;
    if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) continue;
    if (map.has(card.name)) continue;
    const reasons = whyCardMatches(card, commanderProfile);
    if (reasons.length > 0) map.set(card.name, reasons);
  }
  return map;
}

/** Missing summary: cards not allocated to a collection copy. */
export function summarizeMissing(
  cards: DeckDisplayCard[],
  collectionByCopyId: Map<string, EnrichedCard> | undefined,
  currency: CurrencyCode
) {
  if (!collectionByCopyId) return { count: 0, price: 0 };
  let count = 0;
  let price = 0;
  for (const dc of cards) {
    const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
    if (status === 'allocated') continue;
    count += 1;
    price += priceOf(dc.card, currency);
  }
  return { count, price };
}

/** Mainboard cards you own where every copy is in another deck. */
export function countClaimedElsewhere(
  cards: DeckDisplayCard[],
  collectionByCopyId: Map<string, EnrichedCard> | undefined,
  crossDeck: CrossDeckCtx
): number {
  if (!crossDeck.copiesByName || !crossDeck.otherDeckAllocations) return 0;
  let n = 0;
  for (const dc of cards) {
    const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId, {
      cardName: dc.card.name,
      copiesByName: crossDeck.copiesByName,
      allocations: crossDeck.otherDeckAllocations,
    });
    if (status === 'claimed-elsewhere') n += 1;
  }
  return n;
}

/** Tally of the unallocated (missing) cards. */
export function buildMissingTally(
  cards: DeckDisplayCard[],
  collectionByCopyId: Map<string, EnrichedCard> | undefined
) {
  if (!collectionByCopyId) return tallyNames([]);
  const list: ScryfallCard[] = [];
  for (const dc of cards) {
    const status = classifyAllocation(dc.allocatedCopyId ?? null, collectionByCopyId);
    if (status === 'allocated') continue;
    list.push(dc.card);
  }
  return tallyNames(list);
}

type VisibleGroups = TypedGroup[];

/** The flat carousel / inspector index over the three zones' visible rows. */
export function buildFlatIndex(
  visibleGroups: VisibleGroups,
  visibleSideboardGroups: VisibleGroups,
  visibleConsideringGroups: VisibleGroups,
  rarityCorrections: ReadonlyMap<string, string>
) {
  const enrichedCards: EnrichedCard[] = [];
  const labels: string[] = [];
  const rows: Row[] = [];
  const zones: DeckZone[] = [];
  const indexByName = new Map<string, number>();
  // Mainboard first, then sideboard, then considering — so the carousel +
  // hover-peek resolve those cards too (same inspect path as the
  // mainboard). A name only in one zone maps to that zone's entry; a name
  // in more than one keeps the earliest zone's (first wins).
  const pushGroups = (groups: VisibleGroups, zone: DeckZone) => {
    // Tag groupBy is NOT a partition (E171) — a multi-tagged row can appear
    // in more than one of `groups`. Dedupe within this zone's pass so the
    // carousel never repeats the same card as consecutive slides. The other
    // three lenses (including 'stack') do partition, so this is a no-op
    // there rather than a second behavior to keep in step.
    const pushedThisZone = new Set<string>();
    for (const g of groups) {
      for (const row of g.rows) {
        if (pushedThisZone.has(row.name)) continue;
        pushedThisZone.add(row.name);
        if (!indexByName.has(row.name)) indexByName.set(row.name, enrichedCards.length);
        rows.push(row);
        zones.push(zone);
        enrichedCards.push(
          scryfallToEnrichedCard(row.card, {
            frontImageOverride: row.imageNormal,
            backImageOverride: row.imageNormalBack,
            sourceFormat: 'deck-builder',
            overrides: {
              foil: row.foil,
              finish: row.finish,
              finishes: row.finishes,
              promoTypes: row.promoTypes,
              frameEffects: row.frameEffects,
              setCode: row.setCode,
              setName: row.setName,
              collectorNumber: row.collectorNumber,
              rarity: row.card.oracle_id ? rarityCorrections.get(row.card.oracle_id) : undefined,
            },
          })
        );
        labels.push(g.title);
      }
    }
  };
  pushGroups(visibleGroups, 'cards');
  pushGroups(visibleSideboardGroups, 'sideboard');
  pushGroups(visibleConsideringGroups, 'considering');
  return { cards: enrichedCards, labels, rows, zones, indexByName };
}

export type FlatIndex = ReturnType<typeof buildFlatIndex>;

/** Binder(s) a row's allocated copies are filed in, deduped by binder id. */
export function bindersForRow(
  row: Row,
  binderByCopyId: Map<string, BinderInfo[]> | undefined
): BinderInfo[] {
  const binders: BinderInfo[] = [];
  if (binderByCopyId) {
    const seen = new Set<string>();
    for (const cid of row.allocatedCopyIds) {
      for (const b of binderByCopyId.get(cid) ?? []) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          binders.push(b);
        }
      }
    }
  }
  return binders;
}

/** Other-deck claims on a row's allocated copies, deduped on ownerId. */
export function allocationsForRow(
  row: Row,
  otherDeckAllocations: CrossDeckCtx['otherDeckAllocations']
): AllocationInfo[] {
  if (!otherDeckAllocations) return [];
  const seen = new Set<string>();
  const out: AllocationInfo[] = [];
  for (const cid of row.allocatedCopyIds) {
    const a = otherDeckAllocations.get(cid);
    // Dedupe on ownerId, not the legacy deckId alias — every cube
    // claim shares deckId='' and would otherwise collapse to one.
    if (a && !seen.has(a.ownerId)) {
      seen.add(a.ownerId);
      out.push(a);
    }
  }
  return out;
}

export function buildInspectorCard(args: {
  inspectorActive: boolean;
  pinnedName: string | null;
  hoverKey: { name: string; img?: string } | null | undefined;
  commander: ScryfallCard | null;
  flat: FlatIndex;
  binderByCopyId: Map<string, BinderInfo[]> | undefined;
  synergyByName: Map<string, string[]>;
  combosByOracle: Map<string, ComboMatch[]> | undefined;
  cardInclusionMap: Record<string, number> | undefined;
}): DeckCardInspectorCard | null {
  const {
    inspectorActive,
    pinnedName,
    hoverKey,
    commander,
    flat,
    binderByCopyId,
    synergyByName,
    combosByOracle,
    cardInclusionMap,
  } = args;
  if (!inspectorActive) return null;
  const name = pinnedName ?? hoverKey?.name ?? commander?.name;
  if (!name) return null;
  const i = flat.indexByName.get(name);
  if (i === undefined) return null;
  const row = flat.rows[i];
  const enriched = flat.cards[i];
  // Same copy → binder resolution the grid badge does: dedupe by binder id
  // across every allocated copy this aggregated row covers.
  const binders = bindersForRow(row, binderByCopyId);
  return {
    row,
    // A printing sub-row carries its own art; honor it while following the
    // pointer, but a pinned card resolves by name like the carousel does.
    imageUrl:
      (pinnedName ? undefined : hoverKey?.img) || enriched?.imageLarge || enriched?.imageNormal,
    binders,
    synergyReasons: synergyByName.get(name),
    combos: row.card.oracle_id ? combosByOracle?.get(row.card.oracle_id) : undefined,
    inclusionPct: resolveInclusionPct(cardInclusionMap, row),
  };
}

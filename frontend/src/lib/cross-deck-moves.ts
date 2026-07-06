/**
 * Between-your-decks moves (E90): detect a card allocated to one deck that
 * would decisively pull more weight in a sibling deck, paired with an owned
 * replacement that patches the hole it leaves behind. Physical reality is the
 * whole point — one copy, one deck at a time — so a move is only suggested
 * when a patch already exists; otherwise the donor deck would silently get
 * worse and this engine says nothing at all.
 *
 * Pure + isomorphic, lives in `src/lib/**` (coverage-gated). Reuses the same
 * building blocks the deck-builder already validated instead of a parallel
 * scoring system:
 *
 *  - The 23-axis synergy engine (`analyzeDeckSynergy` / `classifyCard`) for
 *    "does this card feed an established engine here?" — the same axis-hit
 *    concept `card-fit.ts`'s `computeAddFit` (the Audition feature) uses. We
 *    call the axis primitives directly rather than `computeAddFit` itself:
 *    that function also ranks replacement cuts (`rankReplacementCuts`), which
 *    this engine doesn't need, and it recomputes a deck's synergy profile
 *    fresh on every call — fine for one audition click, but the wrong access
 *    pattern here, where the SAME sibling deck is checked as a candidate
 *    target for every one of hundreds of allocated cards. So each deck's
 *    profile is materialized once (mirrors `buildBinderPlacement`'s "compute
 *    the shared payoff once, loop cheaply" idiom) and reused for every card.
 *  - `findOwnedSubstitute` (the Coach "Stand-ins" engine) for the replacement
 *    half, fed the outgoing card as the "wanted" role — the same function
 *    that turns a missing EDHREC staple into an owned fill.
 *
 * "Decisive" is a hard, conservative gate, not a tunable score: the card must
 * reinforce ZERO of its own deck's established engines (a pure "generic value
 * piece" there) and AT LEAST ONE of a sibling deck's. A raw axis-hit count of
 * 1-2 is normal for a deck with only a couple of invested axes, so an
 * arbitrary numeric gap threshold would either misfire on small decks or miss
 * real moves on bigger ones — the zero/nonzero split is what "sitting in the
 * wrong deck" actually means, and it's the same bar in a 2-axis cube or a
 * 6-axis pile. A churny suggestion engine destroys trust, so this stays
 * strict by construction rather than by a knob someone has to remember to
 * tune conservatively.
 */
import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import { analyzeDeckSynergy, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { axisLabel } from './axis-overlap';
import { primaryTypeOf, withinColorIdentity, roleOf } from './card-matching';
import { effectiveDeckColors } from './deck-validation';
import {
  findOwnedSubstitute,
  type SubstituteCandidate,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import { pickCollectionCopy, type AllocationInfo } from './allocations';
import { buildCrossDeckMoveFactors, type WhyFactor } from './why-factors';

/** A sibling deck must reinforce at least this many of its established engines
 *  for the card to count as "decisively better there" (paired with reinforcing
 *  ZERO in the donor — see module doc). */
const MIN_TARGET_HITS = 1;

export interface CrossDeckMove {
  /** Stable key: `fromDeckId:cardName:toDeckId`. */
  id: string;
  cardName: string;
  cardTypeLine?: string;
  cardCmc?: number;
  cardImageUrl?: string;
  fromDeckId: string;
  fromDeckName: string;
  fromDeckColor: string;
  /** Slot in `fromDeck.cards` currently holding this card — the move target. */
  slotId: string;
  /** The physical copy bound to that slot — re-bound onto the target deck's
   *  new slot on accept, so the same copy moves rather than a fresh claim. */
  cardCopyId: string;
  toDeckId: string;
  toDeckName: string;
  toDeckColor: string;
  /** Sibling engines reinforced (donor reinforces none — see module doc). */
  fitGain: number;
  replacementName: string;
  replacementTypeLine?: string;
  replacementCmc?: number;
  replacementImageUrl?: string;
  /** The exact free physical copy to bind into the donor's slot on accept. */
  replacementCopyId: string;
  whyMove: WhyFactor[];
  whyReplacement: WhyFactor[];
}

interface DeckProfile {
  deck: Deck;
  identity: string[];
  investedAxes: Set<string>;
  names: Set<string>;
}

function buildProfile(deck: Deck): DeckProfile {
  const synergy: DeckSynergy = analyzeDeckSynergy(deck.cards.map((c) => c.card));
  return {
    deck,
    identity: [...effectiveDeckColors(deck)],
    investedAxes: new Set(synergy.invested),
    names: new Set(deck.cards.map((c) => c.card.name)),
  };
}

interface AxisHit {
  axis: string;
  label: string;
}

/** Axes of `investedAxes` that `card` produces or pays off (deduped). */
function axisHits(card: ScryfallCard, investedAxes: Set<string>): AxisHit[] {
  if (investedAxes.size === 0) return [];
  const cs = classifyCard(card);
  const hit = new Set<string>();
  for (const p of cs.producers) if (investedAxes.has(p.axis)) hit.add(p.axis);
  for (const p of cs.payoffs) if (investedAxes.has(p.axis)) hit.add(p.axis);
  return [...hit].map((axis) => ({ axis, label: axisLabel(axis) }));
}

interface RawCandidate {
  donor: DeckProfile;
  slotId: string;
  cardCopyId: string;
  card: ScryfallCard;
  target: DeckProfile;
  hits: AxisHit[];
}

export interface FindCrossDeckMovesOptions {
  /** Cap the number of suggestions returned (best fitGain first). Default: no cap. */
  limit?: number;
}

/**
 * Find cross-deck moves across every deck the user owns. `collection` is the
 * full owned card list and `allocations` is the live copyId→deck map (e.g.
 * from `useAllocations()`) — both already computed by callers like
 * `DecksIndexPage` for other features, so this never re-derives them.
 */
export function findCrossDeckMoves(
  decks: Deck[],
  collection: EnrichedCard[],
  allocations: Map<string, AllocationInfo>,
  opts: FindCrossDeckMovesOptions = {}
): CrossDeckMove[] {
  if (decks.length < 2) return [];

  const profiles = decks.map(buildProfile);

  // Names with at least one FREE (unallocated) copy — if the moved card's own
  // name is in here, a sibling deck can just claim the spare copy directly;
  // that's gap analysis's job, not a move (see the T37 "physical copy
  // reallocation" framing: never suggest stealing a copy when one is free).
  const freeCountByName = new Map<string, number>();
  for (const c of collection) {
    if (allocations.has(c.copyId)) continue;
    freeCountByName.set(c.name, (freeCountByName.get(c.name) ?? 0) + 1);
  }

  // Pass 1: every candidate move, ranked by fitGain but without a replacement
  // resolved yet — cheap (axis-hit lookups only), so it's fine to compute for
  // every allocated card before doing any substitute search.
  const raw: RawCandidate[] = [];
  for (const donor of profiles) {
    for (const slot of donor.deck.cards) {
      const card = slot.card;
      // ponytail: lands are out of scope for v1 — the "sleeved into the wrong
      // deck" scenario this feature targets is spells/staples (Smothering
      // Tithe, not a Swamp). Manabase moves need their own land-count-aware
      // donor outcome; upgrade path is a separate pass once that exists.
      if (primaryTypeOf(card) === 'Land') continue;
      // Nothing physical to move — an unbound slot is a wanted-but-unowned
      // proxy, not an allocated copy sleeved in the wrong deck.
      if (!slot.allocatedCopyId) continue;
      if ((freeCountByName.get(card.name) ?? 0) > 0) continue;

      const donorHits = axisHits(card, donor.investedAxes);
      if (donorHits.length > 0) continue; // pulls real weight here — not a donation candidate

      let best: { target: DeckProfile; hits: AxisHit[] } | null = null;
      for (const target of profiles) {
        if (target.deck.id === donor.deck.id) continue;
        // Target already runs this card — a singleton (commander-family) deck
        // would be offered a nonsensical duplicate. Applied universally: all
        // current suggestion targets are singleton formats, and skipping is
        // conservative even for a hypothetical 4-of target (v2: copies >= maxCopies).
        if (target.names.has(card.name)) continue;
        if (!withinColorIdentity(card, target.identity)) continue;
        const hits = axisHits(card, target.investedAxes);
        if (hits.length < MIN_TARGET_HITS) continue;
        if (!best || hits.length > best.hits.length) best = { target, hits };
      }
      if (!best) continue;

      raw.push({
        donor,
        slotId: slot.slotId,
        cardCopyId: slot.allocatedCopyId,
        card,
        target: best.target,
        hits: best.hits,
      });
    }
  }

  // Highest fitGain first, so when two donor cards compete for the same
  // replacement (rare, but possible), the stronger move gets first pick.
  raw.sort((a, b) => b.hits.length - a.hits.length);

  // Pass 2: resolve replacements, greedily claiming names so the same owned
  // card is never offered as the patch for two different suggestions at once
  // (mirrors `buildSubstitutionPlan`'s claimed-name set).
  const freePool: SubstituteCandidate[] = [];
  const seenFreeNames = new Set<string>();
  for (const c of collection) {
    if (allocations.has(c.copyId)) continue;
    if (seenFreeNames.has(c.name)) continue;
    seenFreeNames.add(c.name);
    freePool.push({
      name: c.name,
      colorIdentity: c.colorIdentity ?? [],
      cmc: c.cmc,
      typeLine: c.typeLine,
    });
  }

  const claimed = new Set<string>();
  // One suggestion per (card, target): a multi-copy donor emits one raw
  // candidate per slot, but the target can only absorb one copy — extras are
  // noise, collide on `id`, and eat replacements from the claim pool. Marked
  // on success (not up-front) so a different donor's copy still gets a shot
  // when the first donor has no viable patch.
  const suggested = new Set<string>();
  const moves: CrossDeckMove[] = [];

  for (const cand of raw) {
    const moveKey = `${cand.card.name}:${cand.target.deck.id}`;
    if (suggested.has(moveKey)) continue;
    const pool = claimed.size === 0 ? freePool : freePool.filter((c) => !claimed.has(c.name));
    const missing: GapAnalysisCard = {
      name: cand.card.name,
      price: null,
      inclusion: 0,
      synergy: 0,
      typeLine: cand.card.type_line ?? '',
      cmc: cand.card.cmc,
      role: roleOf(cand.card) ?? undefined,
    };
    const sub = findOwnedSubstitute(missing, pool, cand.donor.names, cand.donor.identity);
    if (!sub) continue; // no adequate patch for the donor — no suggestion (see module doc)

    const copy = pickCollectionCopy(sub.usedName, collection, allocations);
    if (!copy) continue; // defensive: findOwnedSubstitute only offers owned names

    claimed.add(sub.usedName);
    suggested.add(moveKey);
    moves.push({
      id: `${cand.donor.deck.id}:${cand.card.name}:${cand.target.deck.id}`,
      cardName: cand.card.name,
      cardTypeLine: cand.card.type_line,
      cardCmc: cand.card.cmc,
      cardImageUrl: cand.card.image_uris?.normal ?? cand.card.image_uris?.small,
      fromDeckId: cand.donor.deck.id,
      fromDeckName: cand.donor.deck.name,
      fromDeckColor: cand.donor.deck.color,
      slotId: cand.slotId,
      cardCopyId: cand.cardCopyId,
      toDeckId: cand.target.deck.id,
      toDeckName: cand.target.deck.name,
      toDeckColor: cand.target.deck.color,
      fitGain: cand.hits.length,
      replacementName: sub.usedName,
      replacementTypeLine: copy.typeLine,
      replacementCmc: copy.cmc,
      replacementImageUrl: copy.imageNormal ?? copy.imageSmall,
      replacementCopyId: copy.copyId,
      whyMove: buildCrossDeckMoveFactors({
        targetAxisLabels: cand.hits.map((h) => h.label),
        toDeckName: cand.target.deck.name,
        fromDeckName: cand.donor.deck.name,
      }),
      whyReplacement: sub.whyFactors ?? [],
    });
  }

  return opts.limit != null ? moves.slice(0, opts.limit) : moves;
}

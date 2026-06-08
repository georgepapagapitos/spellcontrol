/**
 * The canonical shared model for the Tune-tab "prescription" surfaces.
 *
 * The Tune tab consolidates several deck-tuning surfaces (Fill the gaps /
 * Upgrade power / Fit a budget / Build from my collection) plus an in-context
 * carousel "Swap this card" view. Each surface used to render its own bespoke
 * card row; this module gives them one shared `Change` shape so a lane and the
 * card-preview can never disagree about a recommendation, and the shared
 * `<DeckCardRow>` can render any of them.
 *
 * `Change` is a *render* model — ownership is always re-derived live by the
 * caller (never read from a persisted `isOwned` snapshot, which goes stale), and
 * the full `ScryfallCard` is carried only when already resolved; thin EDHREC
 * rows carry `name` + `imageUrl` and resolve lazily on apply.
 */
import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { BracketFitMove } from '@/deck-builder/services/deckBuilder/bracketFit';
import { parsePrice } from '@/deck-builder/services/deckBuilder/costAnalyzer';

export { parsePrice };

export type ChangeType = 'add' | 'cut' | 'swap';

/**
 * The intent lanes a Change can belong to: the four Tune lanes, the carousel's
 * `similar` suggestion rows (not a Tune lane), and the Power tab's `bracket-fit`
 * coaching lane (target-bracket card moves). The hero is a router, not a
 * Change-owning lane.
 */
export type LaneId = 'fill-gaps' | 'upgrade' | 'budget' | 'collection' | 'similar' | 'bracket-fit';

/**
 * Allocation-aware ownership, evaluated at render time:
 * - `owned`         — at least one free (unallocated) copy in the collection.
 * - `in-other-deck` — owned, but every copy is claimed by another deck.
 * - `unowned`       — not in the collection.
 * - `undefined`     — ownership intentionally not evaluated (a cut side is
 *   ownership-blind; you remove a card regardless of whether you own it).
 */
export type ChangeOwnership = 'owned' | 'in-other-deck' | 'unowned' | undefined;

export interface Change {
  /** Stable key, survives re-sorts. cut → slotId; add → `lane:name`; swap → currentName. */
  id: string;
  /** add = net add · cut = remove only · swap = matched remove+add. */
  type: ChangeType;
  /** Owning lane — decides which apply handler commits it. */
  lane: LaneId;

  /** The card the row is about. For a swap this is the card being CUT. */
  name: string;
  /** Full card, only when already resolved (in-deck/removal rows). Thin EDHREC rows omit it. */
  card?: ScryfallCard;

  /** swap only — the replacement being added. */
  inName?: string;
  inCard?: ScryfallCard;

  /** Data-grounded "why" — already the verdict/category copy per surface. */
  reason: string;

  /**
   * Ownership at render time. Re-derive live; never cache from a persisted
   * snapshot. Leave undefined on the cut side (ownership-blind).
   */
  ownership?: ChangeOwnership;

  /**
   * Signed quality delta (PlanScore-ish, a rough inclusion proxy where it
   * exists). `undefined` means "unknown" — summers must NOT coerce it to 0.
   */
  deltaScore?: number;
  /** Signed USD delta. add = +acquire · cut = -value freed · swap = signed (negative = savings). */
  deltaPrice?: number;

  // ── MTG metadata (renders the "why", drives sort + correctness) ──
  /** Functional role key: 'ramp' | 'removal' | 'boardwipe' | 'cardDraw'. */
  role?: string;
  /** Display label: 'Ramp' | 'Removal' | 'Board Wipes' | 'Card Advantage'. */
  roleLabel?: string;
  /** EDHREC inclusion % (0–100). Primary sort key for fill-gaps. undefined → "Off-meta". */
  inclusion?: number;
  /** EDHREC synergy delta. Secondary signal; can be negative. */
  synergy?: number;
  /** Game-changer (bracket-relevant high-power) — must survive (protection + correctness). */
  isGameChanger?: boolean;
  /** Native-engine load-bearing synergy axis card — drives the "Synergy" accent. */
  isThemeSynergy?: boolean;
  /** Section-grouping key (Optimize reasonCategory, Engine axis label, …). */
  group?: string;
  /** Engine axis completion — which half of which synergy axis this fills. */
  axis?: string;
  side?: 'producer' | 'payoff';

  /** Curve-phase filtering + type display. Both can be undefined (thin EDHREC schema). */
  cmc?: number;
  typeLine?: string;
  /** Thumbnail; the row falls back to a Scryfall named-image CDN when absent. */
  imageUrl?: string;
}

/** Sort rank: a free owned copy beats an only-in-other-deck copy beats unowned. */
function ownershipRank(o: ChangeOwnership): number {
  if (o === 'owned') return 0;
  if (o === 'in-other-deck') return 1;
  return 2; // 'unowned' or undefined
}

/**
 * Owned-first ordering (the locked default): an owned card that fills a role
 * surfaces above the unowned staple, then by EDHREC inclusion descending.
 * Stable — equal-rank rows keep their input order.
 */
export function sortOwnedFirst<T extends Change>(changes: readonly T[]): T[] {
  return changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => {
      const rank = ownershipRank(a.change.ownership) - ownershipRank(b.change.ownership);
      if (rank !== 0) return rank;
      const incl = (b.change.inclusion ?? -1) - (a.change.inclusion ?? -1);
      if (incl !== 0) return incl;
      return a.index - b.index; // stable
    })
    .map((x) => x.change);
}

export interface LaneSummary {
  addCount: number;
  cutCount: number;
  /** Net card-count change (adds − cuts) — apply keeps the deck legal at its target. */
  net: number;
  /** Σ of defined `deltaScore`; `null` when none are known (never silently 0). */
  scoreDelta: number | null;
  /** Σ of defined `deltaPrice`; `null` when none parse. */
  priceDelta: number | null;
}

/** Roll a lane's changes into its header summary. undefined deltas stay unknown. */
export function laneSummary(changes: readonly Change[]): LaneSummary {
  let addCount = 0;
  let cutCount = 0;
  let scoreDelta: number | null = null;
  let priceDelta: number | null = null;

  for (const c of changes) {
    if (c.type === 'add' || c.type === 'swap') addCount += 1;
    if (c.type === 'cut' || c.type === 'swap') cutCount += 1;
    if (typeof c.deltaScore === 'number') scoreDelta = (scoreDelta ?? 0) + c.deltaScore;
    if (typeof c.deltaPrice === 'number') priceDelta = (priceDelta ?? 0) + c.deltaPrice;
  }

  return { addCount, cutCount, net: addCount - cutCount, scoreDelta, priceDelta };
}

/**
 * Adapt an off-meta synergy suggestion (the relocated Engine "Synergy picks")
 * into an add Change for the Upgrade lane. Ownership is supplied by the caller
 * (re-derived live); `inclusion` is undefined for genuinely off-meta picks, so
 * the row renders "Off-meta" rather than 0%.
 */
export function fromSynergySuggestion(s: SynergySuggestion, ownership?: ChangeOwnership): Change {
  return {
    id: `upgrade:${s.cardName}`,
    type: 'add',
    lane: 'upgrade',
    name: s.cardName,
    reason: s.reason,
    ownership,
    inclusion: s.inclusion,
    isThemeSynergy: true,
    group: s.axisLabel,
    axis: s.axis,
    side: s.side,
  };
}

/**
 * Adapt an EDHREC gap card (a role-bearing staple the deck is missing) into an
 * add Change — used by the Fill-the-gaps lane and the in-context "Swap this
 * card" view (same-role alternatives). Ownership is supplied live by the caller;
 * the string price is parsed into a signed acquire delta.
 */
export function fromGapCard(g: GapAnalysisCard, ownership?: ChangeOwnership): Change {
  return {
    id: `fill-gaps:${g.name}`,
    type: 'add',
    lane: 'fill-gaps',
    name: g.name,
    reason: g.roleLabel ? `${g.roleLabel} staple` : 'EDHREC staple',
    ownership,
    deltaPrice: parsePrice(g.price) ?? undefined,
    role: g.role,
    roleLabel: g.roleLabel,
    inclusion: g.inclusion,
    synergy: g.synergy,
    cmc: g.cmc,
    typeLine: g.typeLine,
    imageUrl: g.imageUrl,
  };
}

/**
 * Adapt an `OptimizeCard` into a Change. The optimizer emits two pools —
 * `additions` (higher-impact cards to bring in) and `removals` (weak/excess
 * slots to cut) — so `kind` selects which side this row is. Additions are add
 * Changes carrying live ownership; removals are ownership-blind cut Changes (you
 * cut a slot you run regardless of whether you own a copy elsewhere). `group`
 * carries the optimizer's `reasonCategory` for sub-section grouping.
 */
export function fromOptimizeCard(
  o: OptimizeCard,
  kind: 'add' | 'cut',
  ownership?: ChangeOwnership
): Change {
  return {
    id: `upgrade:${kind}:${o.name}`,
    type: kind,
    lane: 'upgrade',
    name: o.name,
    reason: o.reason,
    ownership: kind === 'cut' ? undefined : ownership,
    deltaPrice: o.price != null ? (parsePrice(o.price) ?? undefined) : undefined,
    role: o.role,
    roleLabel: o.roleLabel,
    inclusion: o.inclusion ?? undefined,
    isGameChanger: o.isGameChanger,
    isThemeSynergy: o.isThemeSynergy,
    group: o.reasonCategory,
    cmc: o.cmc,
    typeLine: o.primaryType,
    imageUrl: o.imageUrl,
  };
}

/**
 * Adapt an owned-substitute row into a Change. "Build from my collection"
 * resolves a missing staple you DON'T own to a card you DO own that fills the
 * same role; mechanically that's an **add of the owned card** (nothing is cut —
 * the wanted staple was never in the deck), framed with the wanted context that
 * `substituteFinder` already wrote into `reason` (e.g. "Mind Stone fills the
 * 2-mana ramp slot — owned, same mana rock"). Always owned by construction.
 */
export function fromSubstituteRow(r: SubstituteRow): Change {
  return {
    id: `collection:${r.usedName}`,
    type: 'add',
    lane: 'collection',
    name: r.usedName,
    reason: r.reason,
    ownership: 'owned',
    role: r.wantedRole,
    roleLabel: r.wantedRoleLabel,
    cmc: r.wantedCmc,
  };
}

/** Higher = stronger reason to keep this row when two sources name one card. */
function improveSignal(c: Change): number {
  let s = 0;
  if (c.ownership === 'owned')
    s += 1000; // owned beats everything (zero-spend)
  else if (c.ownership === 'in-other-deck') s += 500;
  if (c.isThemeSynergy || typeof c.synergy === 'number') s += 100; // load-bearing synergy
  if (c.lane === 'upgrade') s += 10; // optimizer-scored (whole-deck balanced)
  return s + (c.inclusion ?? 0); // EDHREC inclusion as the fine tiebreak
}

/**
 * Merge the Improve lane's add candidates from every source (gaps, optimize
 * additions, synergy picks, owned substitutes) into one list: dedupe by card
 * name (case-insensitive), keeping the higher-`improveSignal` row but **unioning**
 * the synergy signal and best-known inclusion/synergy — so a card recommended by
 * two sources surfaces as the stronger of the two (a staple that's also a synergy
 * pick keeps both). Cuts are NOT merged here (handled in the "Consider cutting"
 * sub-section). Returns owned-first order (the locked default).
 */
export function mergeImprove(changes: readonly Change[]): Change[] {
  const byName = new Map<string, Change>();
  for (const c of changes) {
    if (c.type !== 'add') continue;
    const key = c.name.toLowerCase();
    const prior = byName.get(key);
    if (!prior) {
      byName.set(key, { ...c });
      continue;
    }
    const winner = improveSignal(c) >= improveSignal(prior) ? c : prior;
    byName.set(key, {
      ...winner,
      isThemeSynergy: prior.isThemeSynergy || c.isThemeSynergy || undefined,
      inclusion: winner.inclusion ?? prior.inclusion ?? c.inclusion,
      synergy: winner.synergy ?? prior.synergy ?? c.synergy,
    });
  }
  return sortOwnedFirst([...byName.values()]);
}

/**
 * Adapt a Bracket Fit engine {@link BracketFitMove} into a `Change` for the
 * shared `<DeckCardRow>`. The engine emits three move types:
 *   - 'cut'  → cut `name` (ownership-blind, like an Optimize removal). The row
 *     IS the card leaving; its `isGameChanger` flags why it floors the bracket.
 *   - 'swap' → cut `name`, add `inName` (a same-role, lower-power replacement).
 *     The row surfaces the REPLACEMENT (`inName`) as its primary card — so the
 *     thumbnail, inclusion bar, role and ownership all describe the card coming
 *     IN — with the cut card folded into the reason ("Replaces {cut} — …"). The
 *     engine's inclusion/synergy/cmc/type/image already describe the replacement.
 *   - 'add'  → add `name` (power the deck up toward the target); all metadata
 *     describes the added card.
 *
 * Ownership is supplied live by the caller (re-derived each render, never cached)
 * and applies only to the card being ADDED — a pure cut is ownership-blind. For a
 * swap, ownership describes the replacement (the caller resolves it for `inName`).
 */
export function fromBracketFitMove(move: BracketFitMove, ownership?: ChangeOwnership): Change {
  if (move.type === 'swap' && move.inName) {
    // Render the replacement as the primary card; fold the cut into the reason.
    const reason = `Replaces ${move.name} — ${move.reason}`;
    return {
      id: `bracket-fit:swap:${move.name}`,
      type: 'swap',
      lane: 'bracket-fit',
      name: move.inName,
      inName: move.name, // the card being cut (the page reads this to find the slot)
      reason,
      ownership,
      role: move.role,
      roleLabel: move.roleLabel,
      inclusion: move.inclusion,
      synergy: move.synergy,
      // The primary card is the one coming IN. On a downshift swap that's a
      // filtered (never-GC) replacement → false; on an upshift swap it can be a
      // Game Changer, carried as `inIsGameChanger`.
      isGameChanger: move.inIsGameChanger ?? false,
      group: move.signal,
      cmc: move.cmc,
      typeLine: move.typeLine,
      imageUrl: move.imageUrl,
    };
  }

  return {
    id: `bracket-fit:${move.type}:${move.name}`,
    type: move.type,
    lane: 'bracket-fit',
    name: move.name,
    reason: move.reason,
    // Adds carry live ownership; a pure cut is ownership-blind.
    ownership: move.type === 'cut' ? undefined : ownership,
    role: move.role,
    roleLabel: move.roleLabel,
    inclusion: move.inclusion,
    synergy: move.synergy,
    isGameChanger: move.isGameChanger,
    group: move.signal,
    cmc: move.cmc,
    typeLine: move.typeLine,
    imageUrl: move.imageUrl,
  };
}

export interface SwapChangeInput {
  /** The resolved card coming IN (the audition pick). */
  inCard: ScryfallCard;
  /** The in-deck card being CUT to make room. */
  outName: string;
  /** Data-grounded "why this swap" (e.g. the ranked cut's reason). */
  reason: string;
  /** Live ownership of the incoming card (re-derived by the caller, never cached). */
  ownership?: ChangeOwnership;
  /** Owning lane — defaults to `similar` (the audition/swap-in surface). */
  lane?: LaneId;
  /** EDHREC inclusion % of the incoming card, if known. */
  inclusion?: number;
  /** Functional role of the incoming card (key + display label). */
  role?: string;
  roleLabel?: string;
}

/**
 * Build a `type:'swap'` Change for a general add↔cut pair (the E20 audition: "add
 * X, cut Y as one move"). Mirrors the swap shape `fromBracketFitMove` uses and
 * `<DeckCardRow>` renders: `name`/`card` describe the card coming IN (the primary
 * card — its art, role, inclusion, ownership), and `inName` is the card being CUT
 * (the dimmed offender art on the left). The page reads `inName` to find the slot
 * to remove, then adds `name`. Keeps the pairing explicit in the data model
 * instead of buried in a callback closure.
 */
export function fromSwap({
  inCard,
  outName,
  reason,
  ownership,
  lane = 'similar',
  inclusion,
  role,
  roleLabel,
}: SwapChangeInput): Change {
  return {
    id: `swap:${outName}->${inCard.name}`,
    type: 'swap',
    lane,
    name: inCard.name,
    card: inCard,
    inName: outName,
    reason,
    ownership,
    inclusion,
    role,
    roleLabel,
    cmc: inCard.cmc,
    typeLine: inCard.type_line,
    imageUrl: inCard.image_uris?.normal ?? inCard.image_uris?.small,
  };
}

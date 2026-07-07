import { logger } from '@/lib/logger';
import type {
  CoherenceRepair,
  DetectedCombo,
  ScryfallCard,
  DeckCategory,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import { markBanned } from './state';
import { frontFaceName } from '@/lib/card-text';
import { isProtectionPiece, isFreeInteraction } from '@/deck-builder/services/tagger/client';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  notPauperCommanderLegal,
} from '../deckFilters';
import { stampRoleSubtypes, routeCardByType } from '../categorize';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';

export interface ComboAuditContext {
  /** Result of detectCombosPhase — the audit no-ops when undefined. */
  detectedCombos: DetectedCombo[] | undefined;
  /** Full Scryfall card map built during generation (name → card). */
  scryfallCardMap: Map<string, ScryfallCard>;
  budgetTracker: BudgetTracker | null;
  bracketGuard: BracketGuard | undefined;
}

export interface ComboAuditResult {
  /** Updated detected-combos list (rebuilt only when a swap was applied). */
  detectedCombos: DetectedCombo[] | undefined;
  /** Swaps this pass applied, in the same {cut, added, reason} shape every
   *  sibling swap phase discloses (S2 — nothing moves silently). */
  repairs: CoherenceRepair[];
  /** Count of otherwise-eligible candidates skipped for exceeding budget. */
  budgetSkipped: number;
  /** E104: adds auditAdd() blocked for exceeding the target-bracket ceiling
   *  after a weak card was already evicted to make room. */
  bracketBlocked: number;
}

/**
 * ── Combo Integrity Audit ──
 * Verbatim extraction from generateDeckInner. After deck assembly: if a combo
 * piece slipped in but its combo is incomplete, either complete the combo
 * (swap in missing pieces) or evict the low-value orphan. No-op unless combos
 * were detected, EDHREC data is present, and the user asked for combo seeding.
 */
export function comboIntegrityAuditPhase(
  state: GenerationState,
  ctx: ComboAuditContext
): ComboAuditResult {
  const { scryfallCardMap, budgetTracker, bracketGuard } = ctx;
  let detectedCombos = ctx.detectedCombos;
  const repairs: CoherenceRepair[] = [];
  let budgetSkipped = 0;
  let bracketBlocked = 0;

  if (!(detectedCombos && state.edhrecData && state.cfg.comboCountSetting > 0)) {
    return { detectedCombos, repairs, budgetSkipped, bracketBlocked };
  }

  const { categories, usedNames, bannedCards } = state;
  const { commander, partnerCommander, colorIdentity, customization, collectionNames } =
    state.context;
  const { ignoreOwnedBudget, maxCardPrice, currency, collectionStrategy, mtgFormat } = state.cfg;
  const isPdhBuild = mtgFormat === 'paupercommander';

  const ORPHAN_INCLUSION_THRESHOLD = 25; // below this %, the card is considered combo-dependent
  const MAX_AUDIT_SWAPS = 4;
  let auditSwaps = 0;

  // Build inclusion index from EDHREC pool
  const auditInclusion = new Map<string, number>();
  for (const c of state.edhrecData.cardlists.allNonLand) auditInclusion.set(c.name, c.inclusion);

  // Build must-include protection set
  const auditMustInclude = new Set([
    ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
    ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
  ]);

  // Track cards that are part of a COMPLETE combo — never evict them
  const completeComboCards = new Set<string>();
  for (const dc of detectedCombos) {
    if (dc.isComplete) for (const name of dc.cards) completeComboCards.add(name);
  }

  // Count how many detected combos (complete or near-miss) each card appears in.
  // Cards in 2+ combos are valuable enablers and should not be treated as orphans.
  const cardComboCount = new Map<string, number>();
  for (const dc of detectedCombos) {
    for (const name of dc.cards) {
      if (usedNames.has(name)) cardComboCount.set(name, (cardComboCount.get(name) ?? 0) + 1);
    }
  }

  // Helper: find the weakest (lowest inclusion%) evictable non-land card
  function auditWeakest(
    skipNames?: Set<string>
  ): { card: ScryfallCard; category: DeckCategory } | null {
    let best: { card: ScryfallCard; category: DeckCategory; incl: number } | null = null;
    for (const cat of Object.keys(categories) as DeckCategory[]) {
      if (cat === 'lands') continue;
      for (const card of categories[cat]) {
        if (auditMustInclude.has(card.name.toLowerCase())) continue;
        if (completeComboCards.has(card.name)) continue;
        if (isProtectionPiece(card) || isFreeInteraction(card)) continue;
        if (skipNames?.has(card.name)) continue;
        const incl = auditInclusion.get(card.name) ?? 0;
        if (!best || incl < best.incl) best = { card, category: cat, incl };
      }
    }
    return best ? { card: best.card, category: best.category } : null;
  }

  function auditRemove(card: ScryfallCard, category: DeckCategory) {
    categories[category] = categories[category].filter((c) => c !== card);
    usedNames.delete(card.name);
    // E87: this cut is about to be disclosed in coherenceRepairs — veto the
    // name so no downstream add phase (bracket/budget convergence, role-
    // surplus rebalance, lift picks) can silently re-pick it and leave the
    // disclosure describing an intermediate state the shipped deck contradicts.
    markBanned(state, card.name);
  }

  // Same budget gate cardPicking/scryfallFill/coherenceRepair enforce — owned
  // copies are exempt, everything else checks the live effective cap.
  function auditPassesBudget(card: ScryfallCard): boolean {
    if (isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget)) return true;
    const cap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
    return !exceedsMaxPrice(card, cap, currency);
  }

  function auditAdd(card: ScryfallCard): boolean {
    if (usedNames.has(card.name)) return false; // guard against duplicates
    if (bannedCards.has(card.name)) return false; // respect banlist
    // PDH 99s gate — combo candidates come from the (Commander-scoped)
    // EDHREC combo dataset, not the PDH-legal pool.
    if (isPdhBuild && notPauperCommanderLegal(card)) return false;
    // E101: every other add path (cardPicking, scryfallFill) checks the
    // target-bracket ceiling before accepting a card — the combo audit
    // never did, so it could push a bracket<=2 ask's Game Changer/mass
    // land denial/extra-turn/stax signal past the ceiling with no gate at
    // all (e.g. auditAdd seating Teferi, Master of Time into a bracket-2
    // deck, later silently evicted again by bracket convergence).
    if (bracketGuard?.exceedsCeiling(card.name)) {
      bracketBlocked++;
      return false;
    }
    // Defense-in-depth: every call site below pre-filters candidates for
    // color identity before evicting a card to make room (a candidate
    // fetch batch pulls in EVERY combo's cards, on- or off-color, purely
    // to resolve near-miss detection — see the batch fetch above — so this
    // is the only gate standing between an off-identity combo card and the
    // decklist). Sites must still pre-filter so a rejected add doesn't
    // strand the just-evicted card with nothing added back.
    if (!fitsColorIdentity(card, colorIdentity)) return false;
    stampRoleSubtypes(card);
    routeCardByType(card, categories);
    usedNames.add(card.name);
    if (!isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget)) {
      budgetTracker?.deductCard(card);
    }
    bracketGuard?.record(card.name);
    return true;
  }

  // ── Phase 1: Multi-combo enablers ──
  // Before processing individual combos, find single cards NOT in the deck that
  // would complete the most near-miss combos. One Gravecrawler completing 5 combos
  // is far more valuable than 2 cards completing 1 isolated combo.
  {
    // For each missing card across all near-miss combos, count how many combos
    // it would complete if added (i.e., it's the ONLY missing piece for that combo).
    const enablerScore = new Map<string, number>(); // cardName → combos it would complete
    const enablerCombos = new Map<string, string[]>(); // cardName → combo IDs

    for (const dc of detectedCombos) {
      if (dc.isComplete) continue;
      const trulyMissing = dc.missingCards.filter((n) => !usedNames.has(n));
      // Only count combos where this card is the sole missing piece
      if (trulyMissing.length !== 1) continue;
      const name = trulyMissing[0];
      if (bannedCards.has(name) || !scryfallCardMap.has(name)) continue;
      if (constrainsToCollection(collectionStrategy) && notInCollection(name, collectionNames))
        continue;
      // The batch fetch above resolves every combo's cards regardless of
      // color identity (needed to detect near-misses at all) — this is
      // the only gate keeping an off-identity combo card out of the deck.
      if (!fitsColorIdentity(scryfallCardMap.get(name)!, colorIdentity)) continue;
      // Pre-filter mirrors auditAdd's PDH gate so an eviction is never
      // stranded by a rejected add.
      if (isPdhBuild && notPauperCommanderLegal(scryfallCardMap.get(name)!)) continue;
      // E101: pre-filter mirrors auditAdd's bracket-ceiling gate — same
      // stranding concern as the PDH gate above.
      if (bracketGuard?.exceedsCeiling(name)) continue;
      enablerScore.set(name, (enablerScore.get(name) ?? 0) + 1);
      const ids = enablerCombos.get(name) ?? [];
      ids.push(dc.comboId);
      enablerCombos.set(name, ids);
    }

    // Sort by combos completed (descending), only consider cards completing 2+ combos
    const topEnablers = [...enablerScore.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a);

    for (const [name, combosCompleted] of topEnablers) {
      if (auditSwaps >= MAX_AUDIT_SWAPS) break;
      const card = scryfallCardMap.get(name)!;
      if (!auditPassesBudget(card)) {
        budgetSkipped++;
        continue; // next-best enabler under budget
      }
      const weak = auditWeakest();
      if (!weak) break;
      auditRemove(weak.card, weak.category);
      if (auditAdd(card)) {
        auditSwaps++;
        repairs.push({
          cut: weak.card.name,
          added: card.name,
          reason: `${weak.card.name} (${auditInclusion.get(weak.card.name) ?? 0}% inclusion) wasn't earning its slot — swapped for ${card.name}, which completes ${combosCompleted} near-miss combo${combosCompleted === 1 ? '' : 's'}.`,
        });
        // Mark all combos this card completes
        for (const dc of detectedCombos) {
          if (dc.isComplete) continue;
          const stillMissing = dc.missingCards.filter((n) => !usedNames.has(n));
          if (stillMissing.length === 0) {
            dc.isComplete = true;
            dc.missingCards = [];
          }
        }
        // Update completeComboCards so newly completed combo pieces are protected
        for (const dc of detectedCombos) {
          if (dc.isComplete) for (const n of dc.cards) completeComboCards.add(n);
        }
        logger.debug(
          `[DeckGen] Combo audit: added multi-combo enabler ${name} (completes ${combosCompleted} combos) → evicted ${weak.card.name} (${auditInclusion.get(weak.card.name) ?? 0}%)`
        );
      }
    }
  }

  // ── Phase 2: Per-combo completion / orphan eviction (existing logic) ──
  for (const dc of detectedCombos) {
    if (dc.isComplete || auditSwaps >= MAX_AUDIT_SWAPS) continue;

    // Find in-deck pieces that only justify their slot because of this combo.
    // Cards in 2+ combos are valuable enablers — never treat them as orphans.
    const orphans = dc.cards.filter((name) => {
      if (!usedNames.has(name)) return false;
      if (auditMustInclude.has(name.toLowerCase())) return false;
      if (completeComboCards.has(name)) return false;
      if ((cardComboCount.get(name) ?? 0) >= 2) return false;
      return (auditInclusion.get(name) ?? 0) <= ORPHAN_INCLUSION_THRESHOLD;
    });

    if (orphans.length === 0) continue; // all in-deck pieces are fine standalone

    // Check if we can complete the combo: missing pieces must be available, not banned, and not already in deck
    const trulyMissing = dc.missingCards.filter((n) => !usedNames.has(n));
    const missingResolved = trulyMissing
      .filter((n) => !bannedCards.has(n))
      .filter(
        (n) => !(constrainsToCollection(collectionStrategy) && notInCollection(n, collectionNames))
      )
      .map((n) => scryfallCardMap.get(n))
      .filter((c): c is ScryfallCard => !!c)
      // The batch fetch above resolves every combo's cards regardless of
      // color identity (needed to detect near-misses at all) — this is
      // the only gate keeping an off-identity combo card out of the deck.
      .filter((c) => fitsColorIdentity(c, colorIdentity))
      // Pre-filter mirrors auditAdd's PDH gate so an eviction is never
      // stranded by a rejected add.
      .filter((c) => !isPdhBuild || !notPauperCommanderLegal(c))
      // E101: pre-filter mirrors auditAdd's bracket-ceiling gate — same
      // stranding concern as the PDH gate above.
      .filter((c) => !bracketGuard?.exceedsCeiling(c.name))
      .filter((c) => {
        if (auditPassesBudget(c)) return true;
        budgetSkipped++;
        return false;
      });

    // If all "missing" pieces are actually already in the deck now, mark complete and move on
    if (trulyMissing.length === 0) {
      dc.isComplete = true;
      dc.missingCards = [];
      continue;
    }

    const canComplete =
      missingResolved.length === trulyMissing.length &&
      auditSwaps + trulyMissing.length <= MAX_AUDIT_SWAPS;

    if (canComplete) {
      // Swap in the missing pieces by evicting the weakest non-essential cards
      const evicted = new Set<string>();
      let ok = true;
      for (const missing of missingResolved) {
        if (usedNames.has(missing.name)) continue; // already in deck from a prior combo
        const weak = auditWeakest(evicted);
        if (!weak) {
          ok = false;
          break;
        }
        evicted.add(weak.card.name);
        auditRemove(weak.card, weak.category);
        if (!auditAdd(missing)) {
          ok = false;
          break;
        }
        auditSwaps++;
        repairs.push({
          cut: weak.card.name,
          added: missing.name,
          reason: `Completes the ${dc.cards.join(' + ')} combo${dc.results[0] ? ` (${dc.results[0]})` : ''} — swapped in ${missing.name}.`,
        });
      }
      if (ok) {
        logger.debug(
          `[DeckGen] Combo audit: completed combo ${dc.comboId} → added ${missingResolved.map((c) => c.name).join(', ')}`
        );
        dc.isComplete = true;
        dc.missingCards = [];
      }
    } else {
      // Can't complete — evict the orphaned low-value pieces, replace with best EDHREC candidates
      for (const orphanName of orphans) {
        if (auditSwaps >= MAX_AUDIT_SWAPS) break;
        // Never evict lands here — the replacement pool below is
        // allNonLand-only, so an orphaned combo piece that happens to be a
        // land (e.g. Riptide Laboratory) would get silently swapped for a
        // spell, shrinking the land count out from under the resolved
        // target. Lands have their own top-up/target and stay untouched by
        // this audit, same as auditWeakest/findWeakestCard just above.
        let found: { card: ScryfallCard; category: DeckCategory } | null = null;
        for (const cat of Object.keys(categories) as DeckCategory[]) {
          if (cat === 'lands') continue;
          const card = categories[cat].find((c) => c.name === orphanName);
          if (card) {
            found = { card, category: cat };
            break;
          }
        }
        if (!found) continue;
        const replacementCandidates = state.edhrecData.cardlists.allNonLand
          .filter(
            (c) =>
              !usedNames.has(c.name) &&
              !bannedCards.has(c.name) &&
              scryfallCardMap.has(c.name) &&
              fitsColorIdentity(scryfallCardMap.get(c.name)!, colorIdentity) &&
              // E101: pre-filter mirrors auditAdd's bracket-ceiling gate so
              // an orphan eviction is never stranded by a rejected add.
              !bracketGuard?.exceedsCeiling(c.name) &&
              !(
                constrainsToCollection(collectionStrategy) &&
                notInCollection(c.name, collectionNames)
              )
          )
          .sort((a, b) => b.inclusion - a.inclusion);
        // Fall through past budget-exceeding candidates to the next-best one.
        let replacement: (typeof replacementCandidates)[0] | undefined;
        for (const cand of replacementCandidates) {
          if (auditPassesBudget(scryfallCardMap.get(cand.name)!)) {
            replacement = cand;
            break;
          }
          budgetSkipped++;
        }
        if (!replacement) continue;
        auditRemove(found.card, found.category);
        // Gate on the result — an EDHREC-pool candidate should always be
        // legal/unbanned/undupe by construction, but auditAdd is the sole
        // backstop; an unchecked call here previously left the orphan
        // evicted with nothing added back if it ever returned false.
        if (auditAdd(scryfallCardMap.get(replacement.name)!)) {
          auditSwaps++;
          repairs.push({
            cut: orphanName,
            added: replacement.name,
            reason: `${orphanName} was an orphaned piece of an incomplete combo (still missing ${trulyMissing.length} card${trulyMissing.length === 1 ? '' : 's'}) — swapped for ${replacement.name}.`,
          });
          logger.debug(
            `[DeckGen] Combo audit: evicted orphan ${orphanName} (${auditInclusion.get(orphanName) ?? 0}% inclusion) → ${replacement.name}`
          );
        }
      }
    }
  }

  // Rebuild detectedCombos if deck changed so completeness flags are accurate
  if (auditSwaps > 0) {
    const newDeckNames = new Set<string>();
    if (commander) {
      newDeckNames.add(commander.name);
      if (commander.name.includes(' // ')) newDeckNames.add(frontFaceName(commander.name));
    }
    if (partnerCommander) {
      newDeckNames.add(partnerCommander.name);
      if (partnerCommander.name.includes(' // '))
        newDeckNames.add(frontFaceName(partnerCommander.name));
    }
    for (const c of Object.values(categories).flat()) {
      newDeckNames.add(c.name);
      if (c.name.includes(' // ')) newDeckNames.add(frontFaceName(c.name));
    }
    detectedCombos = detectedCombos
      .map((dc) => {
        const missing = dc.cards.filter((n) => !newDeckNames.has(n));
        return { ...dc, isComplete: missing.length === 0, missingCards: missing };
      })
      .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);
    if (detectedCombos.length === 0) detectedCombos = undefined;
    logger.debug(`[DeckGen] Combo audit complete: ${auditSwaps} swap(s) applied`);
  }

  return { detectedCombos, repairs, budgetSkipped, bracketBlocked };
}

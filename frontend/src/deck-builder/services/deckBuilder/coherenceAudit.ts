/**
 * Generation-end coherence audit (E78 phase 1, detection only).
 *
 * Every earlier guard is forward-looking: the synergy-dependency gate blocks
 * adding an unsupported payoff, packageBoost re-ranks toward the scarcer side
 * of live engines — but nothing re-examines cards already committed once the
 * late swap passes (combo audit, fixup, bracket convergence) have reshaped the
 * deck. This runs over the FINAL deck and flags what can no longer justify its
 * slot: payoffs whose engine support never materialized or was trimmed away,
 * cards with no remaining tie to the deck at all, and lopsided engines.
 *
 * Pure and deck-agnostic — never mutates the deck; findings surface in the
 * build report (and can later back an edit-time Coach lane / repair pass).
 */
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { AXES } from '@/deck-builder/services/synergy/axes';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { unsupportedPayoffAxes } from './synergyDependency';
import type { CoherenceFinding } from '@/deck-builder/types';

const AXIS_LABELS = new Map(AXES.map((a) => [a.key, a.label]));

export interface CoherenceAuditInput {
  /** Final nonland mainboard (post every card-mutating pass). */
  nonLandCards: ScryfallCard[];
  /** Commander(s) — counted as engine support but never audited themselves. */
  commanders: ScryfallCard[];
  /** cardName → EDHREC inclusion % (any signal > 0 justifies a slot). */
  cardInclusionMap?: Record<string, number>;
  /** Lowercased cardName → lift co-play seeds (see liftSynergy). */
  liftedByMap?: Record<string, string[]>;
  detectedCombos?: DetectedCombo[];
  /** Sync tagger role lookup — injected so the module stays pure in tests. */
  roleOf?: (name: string) => string | null;
}

export function auditDeckCoherence(input: CoherenceAuditInput): CoherenceFinding[] {
  const { nonLandCards, commanders, cardInclusionMap, liftedByMap, detectedCombos, roleOf } = input;
  const findings: CoherenceFinding[] = [];
  const allCards = [...commanders, ...nonLandCards];
  const deckSynergy = analyzeDeckSynergy(allCards);
  const invested = new Set(deckSynergy.invested);

  const comboNames = new Set<string>();
  for (const combo of detectedCombos ?? []) {
    if (!combo.isComplete) continue;
    for (const n of combo.cards) comboNames.add(n.toLowerCase());
  }

  for (const card of nonLandCards) {
    if (card.isMustInclude) continue; // the user forced it — their call, not a flag

    const deadAxes = unsupportedPayoffAxes(card, allCards, commanders.length);
    if (deadAxes.length > 0) {
      const labels = deadAxes.map((a) => AXIS_LABELS.get(a) ?? a);
      findings.push({
        kind: 'dead-payoff',
        severity: 'warn',
        card: card.name,
        message: `Its ${labels.join(' and ')} payoff has almost nothing feeding it in this deck.`,
      });
      continue; // the more specific finding — don't double-flag the slot below
    }

    const lower = card.name.toLowerCase();
    const cs = classifyCard(card);
    const justified =
      card.isThemeSynergyCard ||
      (cardInclusionMap?.[card.name] ?? 0) > 0 ||
      !!liftedByMap?.[lower] ||
      comboNames.has(lower) ||
      comboNames.has(lower.split(' // ')[0]) ||
      cs.producers.some((p) => invested.has(p.axis)) ||
      cs.payoffs.some((p) => invested.has(p.axis)) ||
      !!(
        card.rampSubtype ||
        card.removalSubtype ||
        card.boardwipeSubtype ||
        card.cardDrawSubtype
      ) ||
      !!roleOf?.(card.name);
    if (!justified) {
      findings.push({
        kind: 'unjustified-slot',
        severity: 'warn',
        card: card.name,
        message: 'No EDHREC signal, engine link, role, or combo ties it to this deck.',
      });
    }
  }

  // Deck-level engine notes last, after the per-card flags they contextualize.
  for (const w of deckSynergy.warnings) {
    findings.push({ kind: 'lopsided-engine', severity: 'info', message: w });
  }

  return findings;
}

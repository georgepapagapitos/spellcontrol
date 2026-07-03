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
import type { DetectedCombo, ManabaseSummary, ScryfallCard } from '@/deck-builder/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { AXES } from '@/deck-builder/services/synergy/axes';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { producedManaColors } from '@/lib/mana-sources';
import { BASIC_LAND_NAMES } from '@/lib/allocations';
import { unsupportedPayoffAxes } from './synergyDependency';
import { BASIC_TYPE_COLORS, fetchedBasicRequirement, WUBRG, type ManaColor } from './manabaseMath';
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
  /** Final manabase — enables the land-sanity detectors when provided. */
  lands?: ScryfallCard[];
  /** The already-computed manabase summary (for the short-color check). */
  manabase?: ManabaseSummary;
}

const COLOR_WORDS: Record<ManaColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};
const BASIC_NAMES: Record<ManaColor, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};
const TYPAL_SHARE_FLOOR = 0.15;
const MIN_COLORLESS_UTILITY = 2;
const FULL_IDENTITY: ReadonlySet<string> = new Set(WUBRG);

const typeLineOf = (c: ScryfallCard): string =>
  (c.type_line ?? c.card_faces?.[0]?.type_line ?? '').toLowerCase();
const oracleOf = (c: ScryfallCard): string =>
  (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '').toLowerCase();

// ponytail: creature subtypes = every word after an em dash in the type line
// (both faces). Good enough for share estimates; not a full typal engine —
// upgrade to real Scryfall subtype data if typal support ever needs precision.
function creatureSubtypes(card: ScryfallCard): string[] {
  const tl = typeLineOf(card);
  if (!tl.includes('creature')) return [];
  return tl
    .split('—')
    .slice(1)
    .join(' ')
    .replace(/\/\//g, ' ')
    .split(/\s+/)
    .filter((w) => w && w !== 'legendary' && w !== 'creature' && w !== '—');
}

const isChangeling = (card: ScryfallCard): boolean =>
  (card.keywords ?? []).some((k) => k.toLowerCase() === 'changeling') ||
  /\bchangeling\b/.test(oracleOf(card));

/** The color whose basic best patches this manabase, preferring `among`. */
function bestBasicFixColor(
  manabase: ManabaseSummary | undefined,
  among?: ManaColor[]
): ManaColor | undefined {
  const lines = manabase?.lines ?? [];
  const pick = (candidates: typeof lines) =>
    candidates.length > 0
      ? [...candidates].sort((a, b) => b.target - b.sources - (a.target - a.sources))[0]
      : undefined;
  const pool = among ? lines.filter((l) => among.includes(l.color as ManaColor)) : lines;
  const line = pick(pool.filter((l) => l.short)) ?? pick(pool);
  return line?.color as ManaColor | undefined;
}

function landSanityFindings(input: CoherenceAuditInput): CoherenceFinding[] {
  const { lands, manabase, nonLandCards, commanders } = input;
  if (!lands || lands.length === 0) return [];
  const findings: CoherenceFinding[] = [];
  const landTypeLines = lands.map(typeLineOf);

  // 1. Dead fetches: the manabase math assumes every fetch finds something
  //    (Karsten source counting) — verify the target actually exists. Typed
  //    targets count by basic land TYPE (Snow-Covered and Triomes qualify).
  const seenFetches = new Set<string>();
  for (const land of lands) {
    if (land.isMustInclude || seenFetches.has(land.name)) continue;
    const req = fetchedBasicRequirement(land);
    if (!req) continue;
    seenFetches.add(land.name);
    if (req.anyBasic) {
      if (!landTypeLines.some((tl) => /\bbasic\b/.test(tl))) {
        findings.push({
          kind: 'land-sanity',
          severity: 'warn',
          card: land.name,
          message: 'It fetches only basic lands, but the deck runs none to find.',
          basicFixColor: bestBasicFixColor(manabase),
        });
      }
    } else {
      const found = req.colors.some((color) => {
        const re = BASIC_TYPE_COLORS.find(([, c]) => c === color)![0];
        return landTypeLines.some((tl) => re.test(tl));
      });
      if (!found) {
        const wanted = req.colors.map((c) => BASIC_NAMES[c]).join(' or ');
        findings.push({
          kind: 'land-sanity',
          severity: 'warn',
          card: land.name,
          message: `It fetches a ${wanted}, but the deck has no land of ${req.colors.length === 1 ? 'that basic type' : 'either basic type'} for it to find.`,
          basicFixColor: bestBasicFixColor(manabase, req.colors),
        });
      }
    }
  }

  // 2. Typal-land support: Path of Ancestry-style (commander creature types)
  //    and Cavern-style "choose a creature type" lands, vs the actual creature
  //    type spread. Report-only — no basicFixColor.
  const creatures = nonLandCards.filter((c) => typeLineOf(c).includes('creature'));
  for (const land of lands) {
    if (land.isMustInclude) continue;
    const oracle = oracleOf(land);
    const sharesCommander = /shares a creature type with your commander/.test(oracle);
    const choosesType = /choose a creature type/.test(oracle);
    if (!sharesCommander && !choosesType) continue;

    let sharing = 0;
    if (sharesCommander) {
      const commanderTypes = new Set(commanders.flatMap(creatureSubtypes));
      if (commanderTypes.size > 0) {
        sharing = creatures.filter(
          (c) => isChangeling(c) || creatureSubtypes(c).some((t) => commanderTypes.has(t))
        ).length;
      }
    } else {
      const counts = new Map<string, number>();
      let changelings = 0;
      for (const c of creatures) {
        if (isChangeling(c)) {
          changelings++;
          continue;
        }
        for (const t of new Set(creatureSubtypes(c))) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      sharing = Math.max(0, ...counts.values()) + changelings;
    }
    const share = creatures.length > 0 ? sharing / creatures.length : 0;
    if (share >= TYPAL_SHARE_FLOOR) continue;
    findings.push({
      kind: 'land-sanity',
      severity: share === 0 ? 'warn' : 'info',
      card: land.name,
      message:
        share === 0
          ? sharesCommander
            ? 'No creature here shares a creature type with your commander — its bonus never triggers.'
            : 'No creature type repeats in this deck — its chosen type covers almost nothing.'
          : sharesCommander
            ? `Only ${sharing} of ${creatures.length} creatures share a creature type with your commander — its bonus will rarely trigger.`
            : `Its chosen creature type covers at most ${sharing} of ${creatures.length} creatures — the mana will often be stuck.`,
    });
  }

  // 3. Utility-land health: only the actionable combination — a color the
  //    manabase summary already calls short AND several colorless-only
  //    nonbasic lands squatting on slots a basic needs. (The shortfall itself
  //    is already the manabase note; this names the slots to free up.)
  const shortColor = manabase?.lines.some((l) => l.short) ? bestBasicFixColor(manabase) : undefined;
  if (shortColor) {
    const colorlessOnly = lands.filter((land, i) => {
      if (land.isMustInclude || /\bbasic\b/.test(landTypeLines[i])) return false;
      if (fetchedBasicRequirement(land)) return false;
      // Positive evidence required: the land demonstrably taps for {C} and
      // nothing colored. Zero mana signal (thin/absent oracle data) must NOT
      // read as colorless — that's missing data, not a colorless land.
      const produced = producedManaColors(land, FULL_IDENTITY);
      return produced.includes('C') && !produced.some((c) => c !== 'C');
    });
    if (colorlessOnly.length >= MIN_COLORLESS_UTILITY) {
      const seen = new Set<string>();
      for (const land of colorlessOnly) {
        if (seen.has(land.name)) continue;
        seen.add(land.name);
        findings.push({
          kind: 'land-sanity',
          severity: 'info',
          card: land.name,
          message: `Colorless-only land while ${COLOR_WORDS[shortColor]} sources run short — a ${BASIC_NAMES[shortColor]} would serve the manabase better.`,
          basicFixColor: shortColor,
        });
      }
    }
  }

  return findings;
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
    if (BASIC_LAND_NAMES.has(card.name)) continue; // basics are mana, never an unjustified slot

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

  // Land-sanity flags after the spell flags, before the deck-level notes.
  findings.push(...landSanityFindings(input));

  // Deck-level engine notes last, after the per-card flags they contextualize.
  for (const w of deckSynergy.warnings) {
    findings.push({ kind: 'lopsided-engine', severity: 'info', message: w });
  }

  return findings;
}

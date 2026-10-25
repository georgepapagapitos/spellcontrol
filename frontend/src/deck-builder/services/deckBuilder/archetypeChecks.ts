/**
 * Archetype checks (roadmap 2.2 / 5.4d): for a deck whose plan is a known
 * archetype, count the cards that plan is built from and say so when a count
 * sits under what real decks of that archetype run.
 *
 * ANALYSIS-ONLY; the generator never imports this. The thresholds are NOT
 * blog numbers: each is the 10th-percentile region of the measured densities in
 * `docs/research/deck-intelligence-2026-10/08-archetype-densities-measured.md`
 * (section 7.2, "Recommended"), taken on 12 EDHREC average decks per archetype
 * (24 for Voltron, which pools equipment) and 7 to 17 Archidekt lists. Each
 * check carries the sample behind it as `[decks meeting the floor, decks
 * sampled]` so the row can show its denominator. Those pairs are the 08 corpus
 * run through `archetypeComponents.ts` (the TypeScript port reproduces the 08
 * CSV counts for 574 decks: every component but artifacts exact on every deck,
 * artifacts within one card on 5).
 *
 * A check fires only when:
 *  - the deck's archetype is one the measurement covers (the app's own read:
 *    `resolveAutoArchetype`, so an owner's pick or chosen theme counts),
 *  - the mainboard is a finished list (`MIN_MAINBOARD`): every threshold was
 *    measured on complete 99-card lists, and an unfinished deck is short of
 *    everything,
 *  - the count is under the floor. A deck at or over it says nothing.
 *
 * Commanders are added to the counts the measurement left them out of ("add 1
 * where the commander is a member", 08 section 5), which can only quiet a flag.
 */
import { Archetype } from '@/deck-builder/types';
import { ARCHETYPE_LABEL } from './strategyVocabulary';
import {
  tallyComponents,
  type ComponentCard,
  type ComponentKey,
  type ComponentTally,
  type TagLookup,
} from './archetypeComponents';

/** Every threshold was measured on 99-card lists; below this a deck is unfinished. */
export const MIN_MAINBOARD = 90;

export type CheckSeverity = 'warn' | 'note';

/** `[decks that meet the floor, decks sampled]`. */
export type Sample = readonly [meets: number, of: number];

interface Tier {
  /** The count the deck should reach: below it the check fires. */
  floor: number;
  severity: CheckSeverity;
  /** EDHREC average decks of this archetype at or over the floor. */
  avg: Sample;
  /** Archidekt lists of this archetype at or over the floor. */
  real: Sample;
}

interface CheckDef {
  id: string;
  archetype: Archetype;
  /** The row's name. */
  title: string;
  /** What the count counts, plural, as it reads after "run 4 or more". */
  what: string;
  /** The component whose card names the row lists. */
  names: ComponentKey;
  count: (t: ComponentTally) => number;
  /** Highest tier first. A deck is told only the strictest tier it misses. */
  tiers: readonly Tier[];
  /** The check speaks only when this holds (token decks that go wide). */
  when?: (t: ComponentTally) => boolean;
}

const lands = (t: ComponentTally) => t.lands + t.count.landFetch;

// Samples: 08 corpus (574 decks) through the port. Floors: 08 section 7.2.
const CHECKS: readonly CheckDef[] = [
  {
    id: 'sacrifice-outlets',
    archetype: Archetype.ARISTOCRATS,
    title: 'Sacrifice outlets',
    what: 'repeatable sacrifice outlets',
    names: 'repeatableOutlet',
    count: (t) => t.count.repeatableOutlet,
    tiers: [{ floor: 4, severity: 'warn', avg: [11, 12], real: [8, 8] }],
  },
  {
    id: 'death-payoffs',
    archetype: Archetype.ARISTOCRATS,
    title: 'Death-trigger payoffs',
    what: 'death-trigger payoffs',
    names: 'deathPayoff',
    count: (t) => t.count.deathPayoff,
    tiers: [{ floor: 4, severity: 'warn', avg: [12, 12], real: [7, 8] }],
  },
  {
    id: 'token-makers',
    archetype: Archetype.TOKENS,
    title: 'Token makers',
    what: 'token makers',
    names: 'tokenMaker',
    count: (t) => t.count.tokenMaker,
    tiers: [{ floor: 8, severity: 'warn', avg: [11, 12], real: [12, 12] }],
  },
  {
    id: 'team-effects',
    archetype: Archetype.TOKENS,
    title: 'Team effects',
    what: 'anthems and team-wide effects',
    names: 'teamEffect',
    count: (t) => t.count.teamEffect,
    tiers: [{ floor: 4, severity: 'warn', avg: [11, 12], real: [11, 12] }],
  },
  {
    // 08 A3: a wide board with no protection. A third of real token lists miss
    // it, so it is a note, not a warning.
    id: 'token-protection',
    archetype: Archetype.TOKENS,
    title: 'Protection',
    what: 'protection spells',
    names: 'protection',
    count: (t) => t.count.protection,
    when: (t) => t.count.tokenMaker >= 10,
    tiers: [{ floor: 2, severity: 'note', avg: [10, 12], real: [8, 12] }],
  },
  {
    id: 'instants-sorceries',
    archetype: Archetype.SPELLSLINGER,
    title: 'Instants and sorceries',
    what: 'instants and sorceries',
    names: 'instantSorcery',
    count: (t) => t.count.instantSorcery,
    tiers: [{ floor: 28, severity: 'warn', avg: [12, 12], real: [10, 10] }],
  },
  {
    id: 'voltron-protection',
    archetype: Archetype.VOLTRON,
    title: 'Protection',
    what: 'protection spells and equipment',
    names: 'protection',
    count: (t) => t.count.protection,
    tiers: [
      { floor: 5, severity: 'warn', avg: [24, 24], real: [9, 10] },
      { floor: 7, severity: 'note', avg: [22, 24], real: [8, 10] },
    ],
  },
  {
    id: 'lands-and-fetch',
    archetype: Archetype.LANDFALL,
    title: 'Lands and land-fetch',
    what: 'lands plus land-fetch cards',
    names: 'landFetch',
    count: lands,
    tiers: [
      { floor: 45, severity: 'warn', avg: [11, 12], real: [10, 11] },
      { floor: 50, severity: 'note', avg: [10, 12], real: [10, 11] },
    ],
  },
  {
    id: 'landfall-payoffs',
    archetype: Archetype.LANDFALL,
    title: 'Landfall payoffs',
    what: 'landfall payoffs',
    names: 'landfallPayoff',
    count: (t) => t.count.landfallPayoff,
    tiers: [{ floor: 6, severity: 'warn', avg: [12, 12], real: [9, 11] }],
  },
  {
    id: 'graveyard-fillers',
    archetype: Archetype.REANIMATOR,
    title: 'Graveyard fillers',
    what: 'cards that mill, loot or surveil',
    names: 'graveyardFiller',
    count: (t) => t.count.graveyardFiller,
    tiers: [{ floor: 4, severity: 'warn', avg: [23, 24], real: [16, 17] }],
  },
  {
    id: 'reanimation',
    archetype: Archetype.REANIMATOR,
    title: 'Reanimation',
    what: 'reanimation effects',
    names: 'reanimation',
    count: (t) => t.count.reanimation,
    tiers: [{ floor: 4, severity: 'warn', avg: [22, 24], real: [17, 17] }],
  },
  {
    id: 'enchantments',
    archetype: Archetype.ENCHANTRESS,
    title: 'Enchantments',
    what: 'enchantments',
    names: 'enchantment',
    count: (t) => t.count.enchantment,
    tiers: [
      { floor: 24, severity: 'warn', avg: [11, 12], real: [9, 9] },
      { floor: 28, severity: 'note', avg: [10, 12], real: [8, 9] },
    ],
  },
  {
    id: 'artifacts',
    archetype: Archetype.ARTIFACTS,
    title: 'Artifacts',
    what: 'artifacts',
    names: 'artifact',
    count: (t) => t.count.artifact,
    tiers: [
      { floor: 22, severity: 'warn', avg: [11, 12], real: [8, 10] },
      { floor: 28, severity: 'note', avg: [10, 12], real: [7, 10] },
    ],
  },
];

/** The archetypes with at least one check. */
export function hasArchetypeChecks(archetype: Archetype | undefined): boolean {
  return archetype !== undefined && CHECKS.some((c) => c.archetype === archetype);
}

export interface ArchetypeCheckFinding {
  id: string;
  severity: CheckSeverity;
  archetype: Archetype;
  title: string;
  count: number;
  floor: number;
  /** What real decks run: "Most Aristocrats decks run 4 or more repeatable sacrifice outlets." */
  claim: string;
  /** The sample behind the claim, with its denominator. */
  basis: string;
  /** Distinct cards that count toward the check. */
  names: string[];
}

export const archetypeWord = (a: Archetype): string => ARCHETYPE_LABEL[a];

const lc = (s: string) => s.toLowerCase();

function basisLine(archetype: Archetype, floor: number, tier: Tier): string {
  const word = lc(archetypeWord(archetype));
  const [am, an] = tier.avg;
  const [rm, rn] = tier.real;
  return `${am} of ${an} EDHREC average ${word} decks and ${rm} of ${rn} Archidekt lists run ${floor} or more.`;
}

/**
 * The checks that have something to say about a deck.
 *
 * @param archetype the deck's resolved archetype (`resolveAutoArchetype`)
 * @param mainboard the 99, commanders excluded
 * @param commanders the command zone, counted toward the components
 * @param tagsOf Scryfall oracle tags; checks need them loaded, so a caller
 *   passes nothing until the index is ready
 */
export function archetypeChecks(input: {
  archetype: Archetype | undefined;
  mainboard: readonly ComponentCard[];
  commanders?: readonly ComponentCard[];
  tagsOf: TagLookup;
}): ArchetypeCheckFinding[] {
  const { archetype, mainboard, commanders = [], tagsOf } = input;
  if (!archetype || !hasArchetypeChecks(archetype)) return [];
  if (mainboard.length < MIN_MAINBOARD) return [];
  const tally = tallyComponents([...mainboard, ...commanders], tagsOf);
  const out: ArchetypeCheckFinding[] = [];
  for (const check of CHECKS) {
    if (check.archetype !== archetype) continue;
    if (check.when && !check.when(tally)) continue;
    const count = check.count(tally);
    // A deck under the warn floor is usually under the note floor too; it is told
    // the warning, not both.
    const missed = check.tiers.filter((t) => count < t.floor);
    if (missed.length === 0) continue;
    const tier = missed.reduce((a, b) => (a.severity === 'warn' ? a : b));
    out.push({
      id: check.id,
      severity: tier.severity,
      archetype,
      title: check.title,
      count,
      floor: tier.floor,
      claim: `Most ${archetypeWord(archetype)} decks run ${tier.floor} or more ${check.what}.`,
      basis: basisLine(archetype, tier.floor, tier),
      names: tally.names[check.names],
    });
  }
  // Warnings first, then notes; the table's order inside each.
  return out.sort((a, b) => Number(b.severity === 'warn') - Number(a.severity === 'warn'));
}

/**
 * Adapter from a LIVE_GEN panel dump (deckGenerator.live.test.ts writes one
 * JSON per deck) to the objective's inputs, so a gate's baseline and treatment
 * panels can be scored mechanically before any critic is spent
 * (scripts/deck-objective-eval.mjs).
 *
 * A dump's cards carry only a 140-character oracle snippet, so every card is
 * resolved to a full Scryfall record by the caller (the evaluator streams
 * Scryfall's oracle_cards bulk file) and the dump's own printing fields
 * (price, rarity, set, games) are laid over it: the price the generator
 * budgeted with is the one a budget constraint must read.
 */
import type {
  Customization,
  DetectedCombo,
  EDHRECCommanderData,
  Pacing,
  ScryfallCard,
} from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import type { EdhrecRow, ObjectiveDeck, ObjectiveRole } from './types';

/** One card as the dump projects it (deckGenerator.live.test.ts projectCard). */
export interface DumpCard {
  name: string;
  mana_cost?: string | null;
  cmc?: number;
  type_line?: string;
  color_identity?: string[];
  rarity?: string;
  set?: string;
  games?: string[] | null;
  price_usd?: string | null;
  price_eur?: string | null;
  edhrec_inclusion?: number | null;
}

export interface PanelDump {
  commander: string;
  variant: string;
  partner?: string | null;
  colorIdentity: string[];
  customization: Partial<Customization> & Record<string, unknown>;
  decklist: Record<string, DumpCard[]>;
  roleTargets?: Partial<Record<ObjectiveRole, number>>;
  detectedPacing?: Pacing;
  detectedCombos?: DetectedCombo[];
  buildReport?: { dataSource?: string } & Record<string, unknown>;
}

/** Every card in the dump's decklist (a dict of buckets), one entry per copy. */
export function dumpCards(dump: PanelDump): DumpCard[] {
  return Object.values(dump.decklist).flat();
}

/** The EDHREC page a dump's generation read: its theme, budget and bracket suffixes. */
export interface DumpPage {
  commander: string;
  partner: string | null;
  /** Theme slug when the run built from a theme page. */
  theme: string | null;
  budgetOption: Customization['budgetOption'] | undefined;
  targetBracket: Customization['targetBracket'] | undefined;
}

export function dumpPage(dump: PanelDump): DumpPage {
  return {
    commander: dump.commander,
    partner: dump.partner ?? null,
    theme: dump.buildReport?.dataSource === 'theme' ? dump.variant : null,
    budgetOption: dump.customization.budgetOption,
    targetBracket: dump.customization.targetBracket,
  };
}

/** EDHREC rows by card name from a parsed page (non-land lists and lands). */
export function edhrecRowsFrom(data: EDHRECCommanderData): Map<string, EdhrecRow> {
  const rows = new Map<string, EdhrecRow>();
  for (const c of [...data.cardlists.allNonLand, ...data.cardlists.lands]) {
    const prev = rows.get(c.name);
    if (prev && prev.inclusion >= c.inclusion) continue;
    rows.set(c.name, {
      inclusion: c.inclusion,
      synergy: c.synergy,
      potential_decks: c.potential_decks,
      num_decks: c.num_decks,
    });
  }
  return rows;
}

/** A dump card over its full Scryfall record, the dump's printing fields winning. */
export function cardFromDump(dc: DumpCard, full: ScryfallCard): ScryfallCard {
  return {
    ...full,
    rarity: dc.rarity ?? full.rarity,
    set: dc.set ?? full.set,
    games: dc.games ?? full.games,
    prices: {
      ...full.prices,
      usd: dc.price_usd ?? full.prices?.usd ?? null,
      eur: dc.price_eur ?? full.prices?.eur ?? null,
    },
  };
}

/** Curly apostrophes straightened: some dumps carry "Atraxa, Praetors’ Voice". */
export function straightQuotes(name: string): string {
  return name.replace(/[‘’]/g, "'");
}

/**
 * Resolve a name to a full record: the exact name first, then the front face
 * (a dump may carry "A // B" where the lookup keyed "A", or the reverse), each
 * also with its apostrophes straightened.
 */
export function resolveName(
  byName: ReadonlyMap<string, ScryfallCard>,
  name: string
): ScryfallCard | undefined {
  const straight = straightQuotes(name);
  return (
    byName.get(name) ??
    byName.get(frontFaceName(name)) ??
    byName.get(straight) ??
    byName.get(frontFaceName(straight))
  );
}

/**
 * The objective's deck from a dump. Throws on a card the resolver can't find:
 * a silently dropped card would score as a different deck.
 */
export function deckFromDump(
  dump: PanelDump,
  byName: ReadonlyMap<string, ScryfallCard>
): ObjectiveDeck {
  const need = (name: string): ScryfallCard => {
    const c = resolveName(byName, name);
    if (!c) throw new Error(`no full card record for "${name}"`);
    return c;
  };
  const commanders = [need(dump.commander), ...(dump.partner ? [need(dump.partner)] : [])];
  const cards = dumpCards(dump).map((dc) => cardFromDump(dc, need(dc.name)));
  return { commanders, cards };
}

/** Combos known for a pair of runs of one spec: the union of both dumps' matcher output. */
export function combosOf(...dumps: PanelDump[]): DetectedCombo[] {
  const seen = new Set<string>();
  const out: DetectedCombo[] = [];
  for (const d of dumps) {
    for (const c of d.detectedCombos ?? []) {
      if (seen.has(c.comboId)) continue;
      seen.add(c.comboId);
      out.push(c);
    }
  }
  return out;
}

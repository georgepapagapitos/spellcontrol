import type { ScryfallCard, DeckFormatConfig } from '@/deck-builder/types';
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from './allocations';
import { validateDeck, type LegalityIssue } from './deck-validation';
import { newDeckCard, type Deck, type DeckCard } from '../store/decks';
import type { EnrichedCard } from '../types';

/**
 * Text/bulk-edit view (E168 slice 4, the last one). The whole point of this
 * module is the reconciliation core: a bulk edit replaces the deck's entire
 * card list, and every surviving card (same name, before and after) MUST
 * keep its `allocatedCopyId` — that's the claim on a specific physical copy.
 * Silently dropping it on a round-trip is data loss (see module doc in the
 * PR / board E168). Resolution is local-first: a name already present
 * anywhere in the deck resolves from the deck itself (no network); only
 * genuinely NEW names need the backend Scryfall resolver.
 */

// ── Parsing ──────────────────────────────────────────────────────────────

export interface ParsedLine {
  name: string;
  qty: number;
}

export interface ParsedBulkEdit {
  /** 0-2 entries: [commander, partner?], in that order — mirrors buildExport's emission order. */
  commanderLines: ParsedLine[];
  main: ParsedLine[];
  sideboard: ParsedLine[];
  considering: ParsedLine[];
  /** Non-blank lines that matched no section header and didn't parse as "qty name". */
  malformedLines: string[];
}

// Section headers this parser understands, matching what `buildExport('mtga', …)`
// emits (deck-export.ts) so the seeded text round-trips exactly. 'companion' is
// a real convention some external tools emit but this app has no deck.companion
// field to round-trip it into — recognized so its lines don't fall through to
// "malformed", just silently dropped (out of scope for this slice).
const SECTION_HEADERS: Record<string, keyof Omit<ParsedBulkEdit, 'malformedLines'> | 'ignore'> = {
  commander: 'commanderLines',
  deck: 'main',
  sideboard: 'sideboard',
  maybeboard: 'considering',
  companion: 'ignore',
};

/** One "qty name" line, tolerating an optional "Nx" quantity and a trailing
 *  "(SET) NUM" printing suffix / Moxfield "*F*"/"*E*" finish tag — matching
 *  is by name only in this slice, so the suffix is stripped, not parsed. */
function parseCardLine(line: string): ParsedLine | null {
  const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  if (!m) return null;
  const qty = parseInt(m[1], 10);
  if (!qty || qty < 1) return null;
  const name = m[2]
    .trim()
    .replace(/\s*\*[FE]\*$/i, '')
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s+\S+$/, '')
    .trim();
  if (!name) return null;
  return { name, qty };
}

export function parseBulkEditText(text: string): ParsedBulkEdit {
  const out: ParsedBulkEdit = {
    commanderLines: [],
    main: [],
    sideboard: [],
    considering: [],
    malformedLines: [],
  };
  let section: keyof Omit<ParsedBulkEdit, 'malformedLines'> | 'ignore' = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const headerKey = trimmed.replace(/:$/, '').toLowerCase();
    if (headerKey in SECTION_HEADERS) {
      section = SECTION_HEADERS[headerKey];
      continue;
    }
    const parsed = parseCardLine(trimmed);
    if (!parsed) {
      out.malformedLines.push(trimmed);
      continue;
    }
    if (section !== 'ignore') out[section].push(parsed);
  }
  return out;
}

// ── Local (offline-capable) resolution ──────────────────────────────────

/** Every card name currently in the deck (commander/partner/main/side/considering),
 *  lowercased → its ScryfallCard payload. This is the offline resolution source —
 *  a bulk edit that only touches quantities/removals never needs the network. */
function collectKnownCards(deck: Deck): Map<string, ScryfallCard> {
  const known = new Map<string, ScryfallCard>();
  const add = (c: ScryfallCard | null | undefined) => {
    if (c) known.set(c.name.toLowerCase(), c);
  };
  add(deck.commander);
  add(deck.partnerCommander);
  for (const c of deck.cards) add(c.card);
  for (const c of deck.sideboard ?? []) add(c.card);
  for (const c of deck.considering ?? []) add(c.card);
  return known;
}

/**
 * Names in `parsed` that resolve to nothing already in the deck — these are
 * the only ones that need a network round-trip. Empty means the whole edit
 * can commit fully offline.
 */
export function findPendingNames(deck: Deck, parsed: ParsedBulkEdit): string[] {
  const known = collectKnownCards(deck);
  const seen = new Set<string>();
  const out: string[] = [];
  const consider = (name: string) => {
    const key = name.toLowerCase();
    if (known.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const l of parsed.commanderLines) consider(l.name);
  for (const l of parsed.main) consider(l.name);
  for (const l of parsed.sideboard) consider(l.name);
  for (const l of parsed.considering) consider(l.name);
  return out;
}

// ── Reconciliation core (pure) ───────────────────────────────────────────

export interface BulkEditDiffEntry {
  name: string;
  qty: number;
}

export interface BulkEditPlan {
  cards: DeckCard[];
  sideboard: DeckCard[];
  considering: DeckCard[];
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: string | null;
  added: BulkEditDiffEntry[];
  removed: BulkEditDiffEntry[];
  /** Parsed names that never resolved to a card, in the deck or via a network attempt. */
  unresolvedNames: string[];
  malformedLines: string[];
  /** Format requires a commander, the deck had one, and the edit left it empty. */
  commanderMissing: boolean;
  legalityIssues: LegalityIssue[];
  /** False when the plan is byte-identical to the current deck — disables Confirm. */
  hasChanges: boolean;
}

/**
 * Builds the full post-edit deck shape. Pure — never mutates `deck`; the
 * caller commits with one `replaceDeck` (see BulkEditDeckDialog), same
 * one-store-write contract as append-deck-import.ts.
 *
 * `resolvedByName` carries ScryfallCards fetched over the network for names
 * NOT already in the deck (see `findPendingNames`) — pass an empty map when
 * the edit needed no network resolution at all.
 */
export function buildBulkEditPlan(
  deck: Deck,
  parsed: ParsedBulkEdit,
  resolvedByName: ReadonlyMap<string, ScryfallCard>,
  formatConfig: DeckFormatConfig,
  ctx: { decks: Deck[]; collectionCards: EnrichedCard[] }
): BulkEditPlan {
  const known = collectKnownCards(deck);
  const resolve = (name: string): ScryfallCard | undefined =>
    known.get(name.toLowerCase()) ?? resolvedByName.get(name.toLowerCase());

  const unresolvedNames = new Set<string>();
  const resolveOrTrack = (name: string): ScryfallCard | null => {
    const card = resolve(name);
    if (!card) {
      unresolvedNames.add(name);
      return null;
    }
    return card;
  };

  // Shared pool of REUSABLE existing slots, keyed by card name — spans
  // main/sideboard/considering so a card that changed ZONE (not just qty)
  // still keeps its allocatedCopyId. Consumed as zones are reconciled below;
  // whatever's left afterward is a genuine removal.
  const pool = new Map<string, DeckCard[]>();
  const fillPool = (list: DeckCard[]) => {
    for (const c of list) {
      const key = c.card.name.toLowerCase();
      const bucket = pool.get(key);
      if (bucket) bucket.push(c);
      else pool.set(key, [c]);
    }
  };
  fillPool(deck.cards);
  fillPool(deck.sideboard ?? []);
  fillPool(deck.considering ?? []);

  // Claims across every OTHER deck (and this deck's current, pre-edit state —
  // reused slots below never call pickCollectionCopy, so this deck's own
  // surviving claims never spuriously block its own growth).
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(ctx.decks));

  const added = new Map<string, number>();

  function reconcileZone(lines: ParsedLine[]): DeckCard[] {
    const out: DeckCard[] = [];
    for (const line of lines) {
      const card = resolveOrTrack(line.name);
      if (!card) continue;
      const key = line.name.toLowerCase();
      const existing = pool.get(key) ?? [];
      const reuseCount = Math.min(line.qty, existing.length);
      const reused = existing.splice(0, reuseCount);
      if (existing.length === 0) pool.delete(key);
      out.push(...reused);
      const growBy = line.qty - reused.length;
      if (growBy > 0) added.set(card.name, (added.get(card.name) ?? 0) + growBy);
      for (let i = 0; i < growBy; i++) {
        const pick = pickCollectionCopy(card.name, ctx.collectionCards, claimed, card.id);
        if (pick) {
          claimed.set(
            pick.copyId,
            makeDeckAllocationInfo('__pending__', '__pending__', '', card.name)
          );
        }
        out.push(newDeckCard(card, pick?.copyId ?? null));
      }
    }
    return out;
  }

  const newMain = reconcileZone(parsed.main);
  const newSide = reconcileZone(parsed.sideboard);
  const newConsidering = reconcileZone(parsed.considering);

  // Whatever's left in the pool never got claimed by a parsed line — removed.
  const removed: BulkEditDiffEntry[] = [...pool.values()].map((slots) => ({
    name: slots[0].card.name,
    qty: slots.length,
  }));

  // Commander/partner: preserve the existing allocatedCopyId when the name is
  // unchanged; otherwise allocate fresh (or leave unbound, same as any other
  // new addition). Format-agnostic decks (hasCommander: false) always resolve
  // to null, matching what buildExport seeds for them (no Commander section).
  const resolveSlot = (
    line: ParsedLine | undefined,
    existingCard: ScryfallCard | null,
    existingCopyId: string | null
  ): { card: ScryfallCard | null; copyId: string | null } => {
    if (!line) return { card: null, copyId: null };
    const card = resolveOrTrack(line.name);
    if (!card) return { card: null, copyId: null };
    if (existingCard && existingCard.name.toLowerCase() === card.name.toLowerCase()) {
      return { card, copyId: existingCopyId };
    }
    const pick = pickCollectionCopy(card.name, ctx.collectionCards, claimed, card.id);
    if (pick) {
      claimed.set(pick.copyId, makeDeckAllocationInfo('__pending__', '__pending__', '', card.name));
    }
    return { card, copyId: pick?.copyId ?? null };
  };

  let commander: ScryfallCard | null = null;
  let partnerCommander: ScryfallCard | null = null;
  let commanderAllocatedCopyId: string | null = null;
  let partnerCommanderAllocatedCopyId: string | null = null;
  let commanderMissing = false;

  if (formatConfig.hasCommander) {
    const [cmdLine, partnerLine] = parsed.commanderLines;
    const cmd = resolveSlot(cmdLine, deck.commander, deck.commanderAllocatedCopyId);
    commander = cmd.card;
    commanderAllocatedCopyId = cmd.copyId;
    commanderMissing = !!deck.commander && !commander;

    const partner = resolveSlot(
      partnerLine,
      deck.partnerCommander,
      deck.partnerCommanderAllocatedCopyId
    );
    partnerCommander = partner.card;
    partnerCommanderAllocatedCopyId = partner.copyId;
  }

  const legalityIssues = validateDeck(newMain, newSide, formatConfig, {
    commander,
    partnerCommander,
  });

  const slotIdSet = (list: DeckCard[]) => new Set(list.map((c) => c.slotId));
  const setsEqual = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((x) => b.has(x));
  const zonesChanged =
    !setsEqual(slotIdSet(newMain), slotIdSet(deck.cards)) ||
    !setsEqual(slotIdSet(newSide), slotIdSet(deck.sideboard ?? [])) ||
    !setsEqual(slotIdSet(newConsidering), slotIdSet(deck.considering ?? []));
  const commanderChanged =
    (commander?.name ?? null) !== (deck.commander?.name ?? null) ||
    (partnerCommander?.name ?? null) !== (deck.partnerCommander?.name ?? null);

  return {
    cards: newMain,
    sideboard: newSide,
    considering: newConsidering,
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    added: [...added.entries()].map(([name, qty]) => ({ name, qty })),
    removed,
    unresolvedNames: [...unresolvedNames],
    malformedLines: parsed.malformedLines,
    commanderMissing,
    legalityIssues,
    hasChanges: zonesChanged || commanderChanged,
  };
}

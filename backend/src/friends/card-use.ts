import { asRecord } from '../shares/projections';

/**
 * Copies a card keeps back before the rest of its free stock counts as spare.
 * Mirrors `SURPLUS_KEEP_COPIES` in `frontend/src/lib/allocations.ts`, the
 * definition behind the owner's own "N free" chip and the trade radar's
 * "spare" — so "spare" on a friend's collection means exactly what it means
 * on yours. Change both or neither.
 */
const KEEP_COPIES = 1;

export interface CardUse {
  /** At least one copy past the kept one that no deck or physical cube claims. */
  spare: boolean;
  /** Visible decks (to this viewer) whose list includes the card. */
  deckIds: string[];
}

interface Row {
  id: string;
  data: unknown;
}

function oracleOf(card: unknown): string {
  const c = asRecord(card);
  return c && typeof c.oracle_id === 'string' ? c.oracle_id : '';
}

/**
 * Per-oracle answer to "can I get this from them?" for a friend's collection.
 *
 * `spare` is computed over EVERY deck and physical cube the owner has, private
 * ones included, because a copy sleeved in a private deck is still not free.
 * It travels as a boolean only: a count is the privacy line on friend
 * surfaces ("contents yes, value no"), and "has one to spare" is all a friend
 * needs before asking. Same exclusions as the client's surplus: basic lands
 * (fungible, never worth flagging) and proxies (a proxy is not the card).
 *
 * `deckIds` names only decks in `visibleDeckIds`, i.e. ones the viewer can
 * already open. Membership is by the deck's LIST (commander, partner, main,
 * sideboard; not "considering"), not by which copy is bound to the slot, so it
 * matches what the viewer sees on the deck page even for an owner who never
 * assigns copies. Naming a private deck here would let a friend rebuild its
 * list card by card, which is why the filter is not optional.
 */
export function summarizeCardUse(
  cards: Row[],
  decks: Row[],
  cubes: Row[],
  visibleDeckIds: ReadonlySet<string>
): Map<string, CardUse> {
  const claimed = new Set<string>();
  const inDecks = new Map<string, Set<string>>();
  const addMember = (oracleId: string, deckId: string) => {
    if (!oracleId) return;
    let s = inDecks.get(oracleId);
    if (!s) inDecks.set(oracleId, (s = new Set()));
    s.add(deckId);
  };

  for (const row of decks) {
    const d = asRecord(row.data);
    if (!d) continue;
    const visible = visibleDeckIds.has(row.id);
    for (const key of ['commanderAllocatedCopyId', 'partnerCommanderAllocatedCopyId']) {
      if (typeof d[key] === 'string') claimed.add(d[key] as string);
    }
    if (visible) {
      addMember(oracleOf(d.commander), row.id);
      addMember(oracleOf(d.partnerCommander), row.id);
    }
    for (const zone of ['cards', 'sideboard', 'considering'] as const) {
      const slots = Array.isArray(d[zone]) ? (d[zone] as unknown[]) : [];
      for (const raw of slots) {
        const slot = asRecord(raw);
        if (!slot) continue;
        if (typeof slot.allocatedCopyId === 'string') claimed.add(slot.allocatedCopyId);
        if (visible && zone !== 'considering') addMember(oracleOf(slot.card), row.id);
      }
    }
  }

  for (const row of cubes) {
    const cube = asRecord(row.data);
    if (!cube || cube.isPhysical !== true || !Array.isArray(cube.picks)) continue;
    for (const raw of cube.picks) {
      const pick = asRecord(raw);
      if (pick && typeof pick.allocatedCopyId === 'string') claimed.add(pick.allocatedCopyId);
    }
  }

  const free = new Map<string, number>();
  const owned = new Set<string>();
  for (const row of cards) {
    const c = asRecord(row.data);
    if (!c || typeof c.oracleId !== 'string' || !c.oracleId) continue;
    owned.add(c.oracleId);
    if (c.proxy === true) continue;
    if (typeof c.typeLine === 'string' && /\bBasic\b/.test(c.typeLine)) continue;
    if (claimed.has(row.id)) continue;
    free.set(c.oracleId, (free.get(c.oracleId) ?? 0) + 1);
  }

  const out = new Map<string, CardUse>();
  for (const oracleId of owned) {
    out.set(oracleId, {
      spare: (free.get(oracleId) ?? 0) > KEEP_COPIES,
      deckIds: [...(inDecks.get(oracleId) ?? [])],
    });
  }
  return out;
}

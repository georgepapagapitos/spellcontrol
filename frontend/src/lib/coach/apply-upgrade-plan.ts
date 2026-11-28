/**
 * Commit an upgrade plan (E458) to a deck: every cut leaves, every add lands
 * with a free owned copy claimed where one exists, in ONE store write and ONE
 * undo entry. The target deck is a parameter so "Apply to a copy" can apply
 * the same plan to a duplicate.
 */
import { useDecksStore, type Deck, type DeckCard } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import {
  buildAllocationMap,
  makeDeckAllocationInfo,
  pickCollectionCopy,
} from '@/lib/collection/allocations';
import { genId } from '@/lib/util/id';

export interface PlanStep {
  addName: string;
  /** The card going out, or null when the add fills an empty slot. */
  cutName: string | null;
}

/**
 * How long an apply waits on the card lookup before it gives up (E1122). Past
 * the bulk lookup's own 30 s, so a stalled server still gets its Scryfall
 * fallback first. A sheet can let the user walk away sooner (`signal`); this
 * is the backstop for one who waits.
 */
export const APPLY_LOOKUP_TIMEOUT_MS = 45_000;

export const APPLY_LOOKUP_TIMEOUT_MESSAGE =
  'Looking up the cards took too long. Nothing changed. Try again.';

const abandoned = () => Object.assign(new Error('Apply abandoned.'), { name: 'AbortError' });

/** The add cards; a rejection once the lookup runs past the deadline, or at
 *  once when `signal` aborts. */
function lookupWithDeadline(
  names: string[],
  signal?: AbortSignal
): ReturnType<typeof getCardsByNames> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abandoned());
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(abandoned());
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(APPLY_LOOKUP_TIMEOUT_MESSAGE));
    }, APPLY_LOOKUP_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort);
    getCardsByNames(names).then(
      (cards) => {
        done();
        resolve(cards);
      },
      (err: unknown) => {
        done();
        reject(err);
      }
    );
  });
}

/** Returns how many steps landed. A card that won't resolve is skipped and
 *  its cut stays in the deck, so the deck never loses a slot. Rejects, with
 *  nothing changed, when the card lookup fails or runs past the deadline, or
 *  when `signal` aborts first (an `AbortError`: the user closed the sheet).
 *  The lookup is the only wait; everything after it is one synchronous store
 *  write, so an apply can always be abandoned up to that write. */
export async function applyUpgradePlan(
  deckId: string,
  steps: PlanStep[],
  options: {
    /** History label; defaults to the upgrade plan's. */
    label?: (count: number) => string;
    /** More fields to write with the cards, in the same store write and undo
     *  entry, given the steps that landed. */
    patch?: (deck: Deck, applied: PlanStep[]) => Partial<Deck>;
    /** Aborted when the user leaves before the lookup answers. Required, so a
     *  caller that drops it fails typecheck instead of applying a plan the
     *  user already walked away from (the Coach feed's wrapper did, E1122). */
    signal: AbortSignal;
    /** Makes the deck the plan lands in, once the lookup has answered and the
     *  apply wasn't abandoned ("Apply to a copy"): a copy made up front had to
     *  be taken back when the user left, with a "Deleted" toast. Defaults to
     *  `deckId` itself. */
    target?: () => string | null;
  }
): Promise<number> {
  const cards = await lookupWithDeadline(
    steps.map((s) => s.addName),
    options.signal
  );
  // The lookup can answer in the same turn the user leaves.
  if (options.signal?.aborted) throw abandoned();
  const targetId = options.target ? options.target() : deckId;
  if (!targetId) return 0;
  const deck = useDecksStore.getState().decks.find((d) => d.id === targetId);
  if (!deck) return 0;

  const allocations = buildAllocationMap(
    useDecksStore.getState().decks,
    useCubeStore.getState().saved
  );
  const collection = useCollectionStore.getState().cards;
  const slotsByName = new Map<string, string[]>();
  for (const c of deck.cards) {
    const k = c.card.name.toLowerCase();
    slotsByName.set(k, [...(slotsByName.get(k) ?? []), c.slotId]);
  }

  const cut = new Set<string>();
  const added: DeckCard[] = [];
  const applied: PlanStep[] = [];
  for (const step of steps) {
    const card = cards.get(step.addName);
    if (!card) continue;
    let slotId: string | undefined;
    if (step.cutName) {
      slotId = slotsByName.get(step.cutName.toLowerCase())?.shift();
      if (!slotId) continue;
    }
    const claim = pickCollectionCopy(step.addName, collection, allocations, card.id);
    // Claimed here so a second step can't take the same physical copy.
    if (claim) {
      allocations.set(
        claim.copyId,
        makeDeckAllocationInfo(targetId, deck.name, deck.color, step.addName)
      );
    }
    if (slotId) cut.add(slotId);
    applied.push(step);
    added.push({
      slotId: genId('slot'),
      card,
      allocatedCopyId: claim?.copyId ?? null,
      addedAt: Date.now(),
    });
  }
  if (added.length === 0) return 0;

  const history = useDeckHistoryStore.getState();
  const before = history.begin(targetId);
  useDecksStore.getState().replaceDeck(targetId, {
    ...deck,
    ...options.patch?.(deck, applied),
    cards: [...deck.cards.filter((c) => !cut.has(c.slotId)), ...added],
  });
  if (before) {
    const label =
      options.label?.(added.length) ??
      `apply upgrade plan (${added.length} ${added.length === 1 ? 'card' : 'cards'})`;
    history.commit(targetId, label, before);
  }
  return added.length;
}

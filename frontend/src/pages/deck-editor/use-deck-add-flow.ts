import { useEffect, useState } from 'react';
import { haptics } from '@/lib/util/haptics';
import { useDecksStore, type Deck, type DeckZone } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useDeckHistoryStore } from '@/store/deck-history';
import { type SizePromptOption } from '@/components/deck/DeckSizePrompt';
import { type ChangeOwnership } from '@/lib/coach/deck-change';
import { type WhyFactor } from '@/lib/coach/why-factors';
import { computeAddFit } from '@/lib/coach/card-fit';
import { classifyCandidate } from '@/lib/deck-analysis/deck-analysis';
import { type CrossDeckMove } from '@/lib/coach/cross-deck-moves';
import { buildAllocationMap, pickCollectionCopy, planCardAdd } from '@/lib/collection/allocations';
import { getMaxCopies } from '@/lib/deck/deck-validation';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  getCardByName,
  getCardsByRefs,
  getOwnedPrinting,
} from '@/deck-builder/services/scryfall/client';
import { parseScryfallCardRefs } from '@/lib/cards/scryfall-card-link';
import { userMessage } from '@/lib/util/user-error';
import { printedName } from '@spellcontrol/binder-routing';
import { ROLE_LABEL } from './deck-editor-helpers';
import type { Dispatch, SetStateAction } from 'react';
import type { BuildTimeNudge } from '@/lib/coach/use-build-time-nudge';
import type { DeckFormatConfig } from '@/deck-builder/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import type { ReplaceCuts } from '@/lib/coach/replace-cuts';
import type { ComboMatchResponse } from '@/types/combos';

export function useDeckAddFlow({
  deckIsFull,
  addZone,
  setShowAddPanel,
  buildTimeNudge,
  deck,
  commanderNames,
  formatConfig,
  mainboardLimit,
  commanderColorIdentity,
  collectionCards,
  isCommander,
  replaceCuts,
  mainboardComboData,
  ownershipFor,
  executeReallocation,
}: {
  deckIsFull: boolean;
  addZone: 'considering' | 'main' | 'side';
  setShowAddPanel: Dispatch<SetStateAction<boolean>>;
  buildTimeNudge: {
    nudge: BuildTimeNudge | null;
    notifyMainboardAdd: (cardName: string) => void;
    dismiss: () => void;
  };
  deck: Deck;
  commanderNames: string[];
  formatConfig: DeckFormatConfig | null;
  mainboardLimit: number;
  commanderColorIdentity: string[];
  collectionCards: EnrichedCard[];
  isCommander: boolean;
  replaceCuts: ReplaceCuts;
  mainboardComboData: ComboMatchResponse | null;
  ownershipFor: (name: string) => ChangeOwnership;
  executeReallocation: (opts: {
    donorDeckId: string;
    donorCubeId?: string;
    recipientDeckId: string;
    recipientApply: () => void;
    donorApply: () => void;
    label: string;
  }) => void;
}) {
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const addSideboardCard = useDecksStore((s) => s.addSideboardCard);
  const addConsideringCard = useDecksStore((s) => s.addConsideringCard);
  const swapCard = useDecksStore((s) => s.swapCard);
  const setCardTags = useDecksStore((s) => s.setCardTags);
  const pushToast = useToastsStore((s) => s.push);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const beginEdit = useDeckHistoryStore((s) => s.begin);
  const commitEdit = useDeckHistoryStore((s) => s.commit);
  const [addingEngineNames, setAddingEngineNames] = useState<Set<string>>(new Set());
  // Deck-size guard prompts: a pending full-deck add awaiting a replace choice,
  // and a post-cut refill nudge (the card just cut + its role).
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  // Set alongside `pendingAdd` when the full-deck prompt opened for a Coach
  // "Your decks" row, so its choices commit the move (the copy comes from the
  // sibling deck, which gets its patch) instead of a plain add.
  const [pendingMove, setPendingMove] = useState<CrossDeckMove | null>(null);
  const pendingMoveFor = pendingMove && pendingMove.cardName === pendingAdd ? pendingMove : null;
  // "Fill the rest" sheet (under-size Commander deck).
  const [showFill, setShowFill] = useState(false);
  // Resolved ScryfallCard for `pendingAdd`, so the replace-when-full ranker can
  // judge relatedness by card type + mana cost (not just name-based role). Tagged
  // with `forName` so a stale resolve from a previous prompt is ignored; null
  // until it resolves, and the ranker degrades to role-only relatedness meanwhile.
  const [pendingAddCard, setPendingAddCard] = useState<{
    forName: string;
    card: ScryfallCard;
  } | null>(null);
  // The exact printing behind `pendingAdd` when the add came with one (a search
  // result, a card dropped from Scryfall), so every way out of the full-deck
  // prompt stores that printing instead of re-resolving the name to the
  // cheapest one. Honored only while its name matches `pendingAdd`.
  const [pendingAddPrinting, setPendingAddPrinting] = useState<ScryfallCard | null>(null);
  // The group the Add cards panel had chosen when the add hit the full prompt,
  // so whichever way out the user takes still files the card into it.
  const [pendingAddGroup, setPendingAddGroup] = useState<string | null>(null);
  const pendingPrinting =
    pendingAdd && pendingAddPrinting?.name === pendingAdd ? pendingAddPrinting : null;
  const [refillAfterCut, setRefillAfterCut] = useState<{
    name: string;
    role: string | null;
  } | null>(null);
  // E20 audition / what-if: a resolved card the user is "previewing the fit" of
  // (from a card-search row or a CoachFeed row) before committing. Drives the
  // CardFitPanel overlay.
  const [auditionCard, setAuditionCard] = useState<ScryfallCard | null>(null);
  // For swap-row auditions from CoachFeed: the outgoing card name to pin as the
  // first cut suggestion in CardFitPanel. Cleared when the panel closes.
  const [auditionPinnedCutName, setAuditionPinnedCutName] = useState<string | null>(null);

  // Resolve the pending-add card so the replace-when-full ranker can use its type
  // + CMC for relatedness. Guarded against races (a newer pendingAdd wins).
  useEffect(() => {
    if (!pendingAdd || pendingPrinting) return;
    let stale = false;
    void getCardByName(pendingAdd).then((scry) => {
      if (!stale && scry) setPendingAddCard({ forName: pendingAdd, card: scry });
    });
    return () => {
      stale = true;
    };
  }, [pendingAdd, pendingPrinting]);

  // The Add cards "+" for a card already resolved to its printing, into the
  // zone the "Add cards to" toggle names. The search panel's + and a card
  // dropped from Scryfall both come through here, so they behave the same.
  // `full` defaults to the deck's own size; a multi-card drop passes its
  // running count. Returns 'full' when it opened the replace-when-full prompt
  // instead of adding.
  const addChosenCard = (
    card: ScryfallCard,
    notify: boolean,
    full: boolean = deckIsFull,
    group: string | null = null
  ): 'added' | 'full' => {
    if (addZone === 'side' || addZone === 'considering') {
      // allocateAndAdd resolves the copy itself (free / auto-move /
      // proxy) — the panel's own pick only ever sees free copies, so
      // routing through it is what makes "add an owned card whose copy
      // is in another deck" Just Work instead of silently proxying.
      allocateAndAdd(card, addZone === 'side' ? 'sideboard' : 'considering', notify, group);
      return 'added';
    }
    // A full Commander deck would overfill — open the intelligent
    // replace-when-full prompt instead of silently going to 101.
    if (full) {
      // The sheet gets out of the way so DeckSizePrompt isn't stacked
      // on top of it.
      setShowAddPanel(false);
      setPendingMove(null);
      setPendingAdd(card.name);
      setPendingAddPrinting(card);
      setPendingAddGroup(group);
      return 'full';
    }
    // Arm the build-time nudge BEFORE the mutation lands, so its
    // baseline token snapshot is genuinely "before" — see
    // notifyMainboardAdd's own doc for why the order matters.
    buildTimeNudge.notifyMainboardAdd(card.name);
    allocateAndAdd(card, 'main', notify, group);
    return 'added';
  };

  // A card link dropped on the editor (a card image dragged off scryfall.com)
  // adds that exact printing through addChosenCard, with the same copy-limit
  // refusal and off-color note the search panel gives its +.
  const addZoneLabel =
    addZone === 'side' ? 'Sideboard' : addZone === 'considering' ? 'Considering' : 'Mainboard';
  const handleScryfallDrop = async (text: string) => {
    const refs = parseScryfallCardRefs(text);
    if (refs.length === 0) {
      pushToast({ message: "That link isn't a Scryfall card.", tone: 'error' });
      return;
    }
    const { cards, error } = await getCardsByRefs(refs).catch((e: unknown) => ({
      cards: [] as ScryfallCard[],
      error: e,
    }));
    if (cards.length === 0) {
      pushToast({
        message: userMessage(error, "Couldn't find that card on Scryfall."),
        tone: 'error',
      });
      return;
    }
    const zoneCards = addZone === 'side' ? deck.sideboard : deck.cards;
    const addedByName = new Map<string, number>();
    let mainCount = deck.cards.length;
    for (const card of cards) {
      const copies =
        zoneCards.filter((c) => c.card.name === card.name).length +
        (addedByName.get(card.name) ?? 0);
      if (addZone === 'main' && commanderNames.includes(card.name)) {
        pushToast({ message: `${card.name} is already your commander.`, tone: 'info' });
        continue;
      }
      if (addZone !== 'considering' && copies >= getMaxCopies(card, !!formatConfig?.isSingleton)) {
        pushToast({ message: `${card.name} is already at its copy limit.`, tone: 'info' });
        continue;
      }
      if (addChosenCard(card, true, addZone === 'main' && mainCount >= mainboardLimit) === 'full')
        break;
      addedByName.set(card.name, (addedByName.get(card.name) ?? 0) + 1);
      if (addZone === 'main') mainCount += 1;
      const offColor =
        commanderColorIdentity.length > 0 &&
        (card.color_identity ?? []).some((k) => !commanderColorIdentity.includes(k));
      if (offColor)
        pushToast(
          addZone === 'main'
            ? { message: `${card.name} is outside your commander's color identity.`, tone: 'warn' }
            : {
                message: `${card.name} is outside your commander's color identity. It can sit here, but not in the mainboard.`,
                tone: 'info',
              }
        );
    }
    const missed = refs.length - cards.length;
    if (missed > 0)
      pushToast({
        message: `Couldn't find ${missed} of the dropped cards on Scryfall.`,
        tone: 'error',
      });
  };

  // The single brain for adding an already-resolved card — used by every add path
  // (collection search panel, Coach/Engine lanes, size-aware prompt) so they behave
  // identically. Binds a free owned copy if one exists; otherwise adds the slot
  // unbound — classifyAllocation renders it "In [deck]" (owned but every copy is
  // elsewhere) or "unowned" (not owned). It NEVER moves a copy out of another deck:
  // pulling a copy in is always a separate, conscious choice (per-row "Use my copy"
  // / the Shared-copies review). This matches what import/generate already do.
  // The Undo a single-add toast carries. It takes back THAT edit: if another
  // edit landed first, Undo says so rather than undoing the wrong one.
  // `topBefore` is the history top before the add, so a no-op add offers nothing.
  const addUndoAction = (deckId: string, topBefore: unknown) => {
    const command = useDeckHistoryStore.getState().topCommand(deckId);
    if (!command || command === topBefore) return {};
    return {
      actionLabel: 'Undo',
      onAction: () => {
        if (!useDeckHistoryStore.getState().undoIfLatest(deckId, command)) {
          pushToast({ message: 'Other edits came after this one.', tone: 'info' });
        }
      },
    };
  };

  const allocateAndAdd = (
    card: ScryfallCard,
    zone: 'main' | 'sideboard' | 'considering',
    notify: boolean,
    group: string | null = null
  ): void => {
    if (!deck) return;
    const plan = planCardAdd(
      card.name,
      card.id,
      collectionCards,
      useDecksStore.getState().decks,
      useCubeStore.getState().saved
    );
    const allocatedId = plan.kind === 'bind' ? plan.copyId : null;
    const label = zone === 'main' ? `add ${card.name}` : `add ${card.name} to ${zone}`;
    const topBefore = useDeckHistoryStore.getState().topCommand(deck.id);
    recordEdit(deck.id, label, () => {
      const slotId =
        zone === 'sideboard'
          ? addSideboardCard(deck.id, card, allocatedId)
          : zone === 'considering'
            ? addConsideringCard(deck.id, card, allocatedId)
            : addCard(deck.id, card, allocatedId);
      // Same write the card menu's "file into group" makes, in the same edit
      // so one undo takes back both.
      if (group) {
        const tagZone: DeckZone =
          zone === 'sideboard' ? 'sideboard' : zone === 'considering' ? 'considering' : 'cards';
        setCardTags(deck.id, tagZone, [slotId], [group]);
      }
    });
    if (notify)
      pushToast({
        message: zone === 'main' ? `Added ${card.name}` : `Added ${card.name} to ${zone}`,
        tone: 'success',
        ...addUndoAction(deck.id, topBefore),
      });
  };

  // Resolve a card by name (Scryfall) then route through allocateAndAdd. Used by
  // the Optimize plan and the Coach/Engine lanes (which only have a card name).
  const addResolvedCard = async (
    cardName: string,
    zone: 'main' | 'sideboard' | 'considering' = 'main',
    printing: ScryfallCard | null = null,
    group: string | null = null
  ) => {
    if (!deck) return;
    setAddingEngineNames((prev) => new Set(prev).add(cardName));
    try {
      const scry = printing ?? (await getCardByName(cardName));
      if (!scry) return;
      allocateAndAdd(scry, zone, true, group);
      haptics.tap();
    } catch {
      pushToast({ message: `Couldn't add ${cardName}`, tone: 'error' });
    } finally {
      setAddingEngineNames((prev) => {
        const next = new Set(prev);
        next.delete(cardName);
        return next;
      });
    }
  };

  // Add from a Tune lane. A Commander deck at its card limit would overfill, so
  // open the replace-when-full prompt instead of silently going to 101; otherwise
  // add straight away.
  const handleAddEngineCard = async (cardName: string) => {
    if (!deck) return;
    if (deckIsFull) {
      setPendingMove(null);
      setPendingAdd(cardName);
      setPendingAddPrinting(null);
      setPendingAddGroup(null);
      return;
    }
    await addResolvedCard(cardName);
  };

  // Cut a single in-deck card by name (the Improve lane's "Consider cutting"
  // rows). removeCard is synchronous, so no in-flight gate. If the cut drops a
  // previously-full Commander deck below the limit, nudge for a same-role refill.
  const handleCutEngineCard = (cardName: string) => {
    if (!deck) return;
    const key = cardName.toLowerCase();
    const slotId = deck.cards.find((c) => c.card.name.toLowerCase() === key)?.slotId;
    if (!slotId) return;
    const wasFull = deck.cards.length >= mainboardLimit;
    recordEdit(deck.id, `cut ${cardName}`, () => removeCard(deck.id, slotId));
    pushToast({ message: `Cut ${cardName}`, tone: 'success' });
    haptics.tap();
    if (isCommander && wasFull) {
      setRefillAfterCut({ name: cardName, role: classifyCandidate(cardName) ?? null });
    }
  };

  // Replace a chosen in-deck card with the pending add (1-for-1 keeps the deck
  // legal): cut the slot first so its physical copy frees up, then add.
  const handleReplaceWhenFull = async (cutSlotId: string) => {
    if (!deck || !pendingAdd) return;
    const name = pendingAdd;
    const printing = pendingPrinting;
    const group = pendingAddGroup;
    setPendingAdd(null);
    if (pendingMoveFor) {
      // Atomic 1-for-1 here too: the cut frees its copy, the moved one binds.
      await commitCrossDeckMove(pendingMoveFor, (deckId, card, copyId) =>
        swapCard(deckId, cutSlotId, card, copyId)
      );
      return;
    }
    const cutName = deck.cards.find((c) => c.slotId === cutSlotId)?.card.name;
    setAddingEngineNames((prev) => new Set(prev).add(name));
    try {
      const scry = printing ?? (await getCardByName(name));
      if (!scry) {
        pushToast({ message: `Couldn't add ${name}`, tone: 'error' });
        return;
      }
      const before = beginEdit(deck.id);
      const topBefore = useDeckHistoryStore.getState().topCommand(deck.id);
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      const claim = pickCollectionCopy(name, collectionCards, allocations, scry.id);
      // Atomic 1-for-1: never passes through a transient over/under-size state.
      const newSlotId = swapCard(deck.id, cutSlotId, scry, claim?.copyId ?? null);
      // Filed in the same edit as the swap, so one undo takes back both.
      if (group && newSlotId) setCardTags(deck.id, 'cards', [newSlotId], [group]);
      if (before)
        commitEdit(deck.id, cutName ? `replace ${cutName} → ${name}` : `add ${name}`, before);
      pushToast({
        message: `Added ${name}`,
        tone: 'success',
        ...addUndoAction(deck.id, topBefore),
      });
      haptics.tap();
    } catch {
      pushToast({ message: `Couldn't add ${name}`, tone: 'error' });
    } finally {
      setAddingEngineNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  // Full-deck escape hatches: stash the card off-mainboard, or add over-limit.
  const closeFullPromptInto = async (
    zone: 'main' | 'sideboard' | 'considering',
    moveAdd: Parameters<typeof commitCrossDeckMove>[1]
  ) => {
    if (!pendingAdd) return;
    const name = pendingAdd;
    const printing = pendingPrinting;
    const group = pendingAddGroup;
    setPendingAdd(null);
    if (pendingMoveFor) return commitCrossDeckMove(pendingMoveFor, moveAdd);
    await addResolvedCard(name, zone, printing, group);
  };
  const addToSideboardAndClose = () => closeFullPromptInto('sideboard', addSideboardCard);
  const addToConsideringAndClose = () => closeFullPromptInto('considering', addConsideringCard);
  const addAnywayAndClose = () => closeFullPromptInto('main', addCard);

  // Replace-when-full options (E20 intelligent cuts): rank cuts by how
  // *related/replaceable* they are vs the card being added (shared role, same
  // type, similar CMC) and surface the optimizer's real per-card reason instead
  // of a flat "weak slot". `all` is every deck card for "pick another". Plain
  // consts (not hooks), only meaningful while a prompt is open. `anyRelated` drives honest copy: when no cut actually
  // relates to the add, the prompt says "make room" rather than implying a swap.
  const replaceOptions =
    !pendingAdd || !deck
      ? null
      : (() => {
          const labelFor = (name: string): string | undefined => {
            const r = classifyCandidate(name);
            return r ? ROLE_LABEL[r] : undefined;
          };
          const toOpt = (
            c: { slotId: string; card: ScryfallCard },
            hint?: string,
            factors?: WhyFactor[]
          ): SizePromptOption => ({
            key: c.slotId,
            name: c.card.name,
            roleLabel: labelFor(c.card.name),
            hint,
            factors,
            onPick: () => void handleReplaceWhenFull(c.slotId),
          });
          // Stub when the add card hasn't resolved yet (or the resolve is for a
          // previous prompt) — name-based role still works.
          const resolvedAdd =
            pendingPrinting ??
            (pendingAddCard?.forName === pendingAdd ? pendingAddCard.card : null);
          const addCard: ScryfallCard =
            resolvedAdd ?? ({ name: pendingAdd, type_line: '', cmc: 0 } as ScryfallCard);
          const ranked = replaceCuts.cutsFor(addCard);
          const suggested = ranked.map((r) =>
            toOpt({ slotId: r.slotId, card: r.card }, r.reason, r.factors)
          );
          const anyRelated = ranked.some((r) => r.related);
          const all = [...deck.cards]
            .sort((a, b) => printedName(a.card).localeCompare(printedName(b.card)))
            .map((c) => toOpt(c));
          return { suggested, all, anyRelated };
        })();

  // E20 audition fit report — engine/curve/role/color + ranked cuts for the card
  // the user is previewing. Computed only while the panel is open (a plain const,
  // like replaceOptions).
  const auditionReport =
    auditionCard && deck
      ? computeAddFit({
          addCard: auditionCard,
          deckCards: deck.cards,
          analysis: deck,
          inDeckCombos: mainboardComboData?.inDeck,
          commanderColorIdentity,
        })
      : null;

  // Refill-after-cut options: same-role staples the deck is missing (owned-first
  // hint), to bring the deck back to its legal count.
  const refillOptions: SizePromptOption[] =
    !refillAfterCut || !deck
      ? []
      : (() => {
          const role = refillAfterCut.role;
          const deckNames = new Set(deck.cards.map((c) => c.card.name.toLowerCase()));
          return (deck.gapAnalysis ?? [])
            .filter((g) => (!role || g.role === role) && !deckNames.has(g.name.toLowerCase()))
            .slice(0, 8)
            .map((g) => ({
              key: g.name,
              name: g.name,
              roleLabel: g.roleLabel,
              hint: ownershipFor(g.name) === 'owned' ? 'owned' : undefined,
              onPick: () => {
                setRefillAfterCut(null);
                void addResolvedCard(g.name);
              },
            }));
        })();

  // Commit a "Your decks" move: the physical copy leaves its sibling deck for
  // this one, and the owned replacement takes its slot there. `place` seats the
  // card here (a plain add, a 1-for-1 swap into a full deck, or another zone).
  // One Undo restores both decks (executeReallocation).
  const commitCrossDeckMove = async (
    move: CrossDeckMove,
    place: (deckId: string, card: ScryfallCard, copyId: string) => void
  ): Promise<void> => {
    if (!deck) return;
    const donor = useDecksStore.getState().decks.find((d) => d.id === move.fromDeckId);
    const slot = donor?.cards.find((c) => c.slotId === move.slotId);
    const patch = collectionCards.find((c) => c.copyId === move.replacementCopyId);
    if (!donor || !slot || !patch) {
      pushToast({
        message: `${move.cardName} has changed since this suggestion.`,
        tone: 'error',
      });
      return;
    }
    setAddingEngineNames((prev) => new Set(prev).add(move.cardName));
    try {
      const patchCard = await getOwnedPrinting(patch.scryfallId, patch.name);
      executeReallocation({
        donorDeckId: donor.id,
        recipientDeckId: deck.id,
        recipientApply: () => place(deck.id, slot.card, slot.allocatedCopyId ?? move.cardCopyId),
        donorApply: () => swapCard(donor.id, slot.slotId, patchCard, patch.copyId),
        label: `Moved ${move.cardName} here. ${patch.name} covers ${donor.name}.`,
      });
    } catch {
      pushToast({ message: `Couldn't move ${move.cardName}`, tone: 'error' });
    } finally {
      setAddingEngineNames((prev) => {
        const next = new Set(prev);
        next.delete(move.cardName);
        return next;
      });
    }
  };

  return {
    setAuditionPinnedCutName,
    setAuditionCard,
    addChosenCard,
    setPendingMove,
    setPendingAdd,
    setPendingAddPrinting,
    setPendingAddGroup,
    commitCrossDeckMove,
    handleAddEngineCard,
    handleCutEngineCard,
    setShowFill,
    addingEngineNames,
    auditionCard,
    auditionReport,
    auditionPinnedCutName,
    showFill,
    pendingAdd,
    replaceOptions,
    pendingMoveFor,
    addToSideboardAndClose,
    addToConsideringAndClose,
    addAnywayAndClose,
    refillAfterCut,
    refillOptions,
    setRefillAfterCut,
    addZoneLabel,
    handleScryfallDrop,
  };
}

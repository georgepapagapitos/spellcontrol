import type { PlaytestState } from '@/lib/playtest';
import type { Deck } from '@/store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import { cachedCardThumb } from '@/lib/cards/card-thumbs';
import type { OnlineHordeResult } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import { sideboardInstanceId } from '../../lib/deck-to-playtest';
import { displayPT } from '../../lib/power-toughness';
import { matchTriggers } from '../../lib/triggers';
import type { SoloHordeState } from '../../lib/horde-solo';
import type { PreviewFaces } from '../CardHoverPreview';
import { opponentPreviewId } from '../OpponentQuadrant';
import type { StackPanelItem } from '../StackPanel';
import type { TriggerCard } from '../TriggerReminder';

// Values PlaytestBoard derives from its state and the deck, lifted out as
// plain functions. The board still calls them at the same points (inside the
// same useMemo where it memoized), so nothing recomputes more or less often.

/** Map from each PlaytestCard instance id back to the underlying
 *  ScryfallCard, so the OpeningHandSheet can pass full card data to the
 *  shared CardPreview component without changing reducer types. The keys
 *  mirror what `deckToPlaytestInit` produces (slotId#copy for mainboard,
 *  cmd-<scryfallId> for commanders, sb-<slotId> for the sideboard). */
export function buildCardLookup(deck: Deck | undefined) {
  if (!deck) return undefined;
  const map = new Map<string, ScryfallCard>();
  deck.cards.forEach((slot, i) => {
    map.set(`${slot.slotId}#${i}`, slot.card);
  });
  if (deck.commander) map.set(`cmd-${deck.commander.id}`, deck.commander);
  if (deck.partnerCommander) map.set(`cmd-${deck.partnerCommander.id}`, deck.partnerCommander);
  for (const slot of deck.sideboard ?? []) map.set(sideboardInstanceId(slot.slotId), slot.card);
  return map;
}

/** Image per card instance for the hover preview — the DOM carries only ids.
 *  A two-faced card previews BOTH faces, the one showing first. */
export function buildPreviewSrcs(
  battlefield: PlaytestState['battlefield'],
  hand: PlaytestState['zones']['hand'],
  command: PlaytestState['zones']['command']
) {
  const m = new Map<string, PreviewFaces>();
  for (const b of battlefield) {
    if (b.faceDown || !b.card.imageUrl) continue;
    const back = b.card.backImageUrl;
    m.set(b.card.id, {
      ...(back && b.showBackFace
        ? { src: back, back: b.card.imageUrl }
        : { src: b.card.imageUrl, ...(back && { back }) }),
      counters: b.counters,
      pt: displayPT(b.card, b) ?? undefined,
    });
  }
  for (const c of [...hand, ...command])
    if (c.imageUrl)
      m.set(c.id, { src: c.imageUrl, ...(c.backImageUrl && { back: c.backImageUrl }) });
  return m;
}

/** The opponents' permanents, by the seat-scoped id their quadrant publishes
 *  as `data-preview-id`. Names, not URLs: `PublicBoard` never carries image
 *  URLs (projection.ts), so the quadrant resolves art through the shared CDN
 *  cache and this reads the same cache back. */
export function buildOpponentPreviewNames(opponents: OnlineTable['opponents'] | readonly []) {
  const m = new Map<
    string,
    { name: string; counters: Record<string, number>; pt?: ReturnType<typeof displayPT> }
  >();
  for (const opp of opponents) {
    for (const bf of opp.board.battlefield) {
      if (bf.faceDown || !bf.card.name) continue;
      m.set(opponentPreviewId(opp.board.seat, bf.card.id), {
        name: bf.card.name,
        counters: bf.counters,
        pt: displayPT(bf.card, bf),
      });
    }
  }
  return m;
}

/** One list for the whole table's stack: your own from the reducer, everyone
 *  else's from their published board. */
export function buildStackItems(
  battlefield: PlaytestState['battlefield'],
  stackIds: PlaytestState['stack'],
  onlineTable: OnlineTable | null
): StackPanelItem[] {
  const mine: StackPanelItem[] = (stackIds ?? []).flatMap((id) => {
    const bf = battlefield.find((b) => b.card.id === id);
    if (!bf) return [];
    return [
      {
        id,
        name: bf.card.name,
        imageUrl: bf.showBackFace && bf.card.backImageUrl ? bf.card.backImageUrl : bf.card.imageUrl,
        manaCost: bf.card.manaCost,
        isToken: bf.card.isToken === true,
        seat: onlineTable?.mySeat ?? null,
        seatName: onlineTable ? 'You' : undefined,
        mine: true,
      },
    ];
  });
  if (!onlineTable) return mine;
  const theirs: StackPanelItem[] = [];
  for (const opp of onlineTable.opponents) {
    for (const id of opp.board.stack ?? []) {
      const bf = opp.board.battlefield.find((b) => b.card.id === id);
      if (!bf || bf.faceDown) continue;
      theirs.push({
        id: opponentPreviewId(opp.board.seat, id),
        name: bf.card.name ?? 'A spell',
        // An opponent's board never carries image URLs (projection.ts) —
        // the art comes back out of the shared CDN cache by name.
        imageUrl: bf.card.name ? (cachedCardThumb(bf.card.name, 'normal') ?? undefined) : undefined,
        isToken: bf.card.isToken === true,
        seat: opp.board.seat,
        seatName: opp.name,
        mine: false,
      });
    }
  }
  return [...mine, ...theirs];
}

/**
 * Your permanents that carry an "at the beginning of …" trigger, for the
 * boundary reminder. Read off `cardLookup` rather than the reducer, since
 * `PlaytestCard` deliberately holds no oracle text.
 *
 * Face-down and phased-out permanents are left out: a face-down card is a
 * 2/2 with no abilities, and a phased-out one is not there to trigger. A
 * token, or any card the lookup can't key, has no oracle text to read and so
 * never reminds.
 */
export function buildTriggerCards(
  cardLookup: Map<string, ScryfallCard> | undefined,
  battlefield: PlaytestState['battlefield']
): TriggerCard[] {
  if (!cardLookup) return [];
  const out: TriggerCard[] = [];
  for (const bf of battlefield) {
    if (bf.faceDown || bf.phased) continue;
    const sc = cardLookup.get(bf.card.id);
    if (!sc) continue;
    const faces = sc.card_faces;
    const text = bf.showBackFace
      ? (faces?.[1]?.oracle_text ?? sc.oracle_text)
      : (sc.oracle_text ?? faces?.[0]?.oracle_text);
    const hits = matchTriggers(text);
    if (hits.length > 0) out.push({ id: bf.card.id, name: bf.card.name, hits });
  }
  return out;
}

/** The online horde's phase and the copy/actions the chip, half, band and
 *  sheets derive from it. Everything here is null/undefined off a horde
 *  table. */
export function deriveOnlineHorde(onlineHorde: OnlineHordeResult | null) {
  // A horde at an online table (E387 online co-op): 'setup' and 'survivors'
  // read as one "team's turn" phase everywhere the chip/half/band/rail wording
  // groups them (STYLE_GUIDE "Horde at an online table") — 'reveal'/'combat'
  // are the horde's own turn, and 'ended' overrides all of it once the
  // replay has an outcome.
  const onlineHordePhase: 'setup' | 'survivors' | 'reveal' | 'combat' | 'ended' | null =
    !onlineHorde
      ? null
      : onlineHorde.replay?.view.phase === 'ended'
        ? 'ended'
        : onlineHorde.team.inSetup
          ? 'setup'
          : onlineHorde.team.phase;
  // The status half of HordeHalf's "Standard · <status>" line, and the
  // team-turn chip's readout copy — "team" instead of solo's "you" throughout.
  const onlineHordeStatusText = !onlineHorde
    ? undefined
    : onlineHordePhase === 'setup'
      ? `Arrives after team turn ${onlineHorde.team.setupTurns}`
      : onlineHordePhase === 'survivors'
        ? 'Its turn comes when the team is done'
        : onlineHordePhase === 'reveal'
          ? 'The horde reveals'
          : onlineHordePhase === 'combat'
            ? 'The horde attacks'
            : onlineHorde.replay?.outcome === 'won'
              ? 'The horde is gone'
              : 'Overrun';
  // HordeBand's folded line needs the setup case's own wording ("team turn",
  // not solo's "your turn") — every other phase already reads correctly off
  // the default `hordeBandLine` once `playerTurn` is the team's own turn
  // count (below), since `armedAtTurn` is fixed at 1 in every online replay.
  const onlineHordeBandStatusText =
    onlineHorde && onlineHordePhase === 'setup'
      ? `${onlineHorde.replay?.view.config.hordeName} · arrives after team turn ${onlineHorde.team.setupTurns}`
      : undefined;
  // HordeHalf/HordeBand's `hordeLoad` shape, off `useOnlineHorde`'s own
  // status — 'skew' is carried separately via `blocked` below, and 'none'/
  // 'ready' both read as idle (nothing to show).
  const onlineHordeLoadView: { status: 'idle' | 'loading' | 'error'; error: string | null } = {
    status:
      onlineHorde?.status === 'loading'
        ? 'loading'
        : onlineHorde?.status === 'error'
          ? 'error'
          : 'idle',
    error: onlineHorde?.error ?? null,
  };
  const onlineHordeBlocked =
    onlineHorde?.status === 'skew'
      ? {
          message: "This table's horde comes from a newer version of the app. Reload to join in.",
          actionLabel: 'Reload',
          onAction: () => window.location.reload(),
        }
      : undefined;
  // extraAction ("Go now") on the phone band: only while waiting on
  // teammates and only outside the horde's own turn — matches the desktop
  // "Start without …" button under the team-turn chip.
  const onlineHordeExtraAction =
    onlineHorde &&
    onlineHorde.team.iAmDone &&
    onlineHorde.team.waitingOn.length > 0 &&
    onlineHordePhase !== 'reveal' &&
    onlineHordePhase !== 'combat'
      ? {
          label: 'Go now',
          ariaLabel: `Start without ${onlineHorde.team.waitingOn.join(', ')}`,
          onClick: () => onlineHorde.startWithout(),
        }
      : undefined;
  // Flattened once so the reveal/end/overlay sheets below don't each repeat
  // the same `onlineHorde?.replay?.…` chain (and so narrowing on a plain
  // `const` — not a repeated optional chain — is what decides whether they
  // render).
  const onlineHordeView: SoloHordeState | null = onlineHorde?.replay?.view ?? null;
  const onlineHordeOutcome: 'won' | 'lost' | null = onlineHorde?.replay?.outcome ?? null;
  const onlineHordePendingReveal =
    onlineHordeView?.phase === 'reveal' ? (onlineHordeView.pendingReveal ?? null) : null;
  return {
    onlineHordePhase,
    onlineHordeStatusText,
    onlineHordeBandStatusText,
    onlineHordeLoadView,
    onlineHordeBlocked,
    onlineHordeExtraAction,
    onlineHordeView,
    onlineHordeOutcome,
    onlineHordePendingReveal,
  };
}

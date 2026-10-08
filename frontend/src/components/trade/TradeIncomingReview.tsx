import './TradeIncomingReview.css';
import { useEffect, useId, useMemo, useState } from 'react';
import { getCardById } from '@/lib/api';
import { useBinderByCopyId } from '@/lib/binder/use-binder-by-copy';
import { formatLocation, useCardLocations } from '@/lib/binder/card-locations';
import { useAllocations } from '@/lib/collection/allocations';
import { formatMoney } from '@/lib/collection/format-money';
import {
  copiesFromCounts,
  defaultPrintingCounts,
  groupByPrinting,
  printingShortfall,
  setPrintingCountBalanced,
  sumCopyValue,
  toTradeCardFromCopies,
  type OwnedTradeLine,
  type PrintingRef,
  type PrintingCounts,
  type PrintingGroup,
} from '@/lib/trade/trade-picker';
import { resolveTradePreview } from '@/lib/trade/trade-preview';
import { describeNet, type SideValue } from '@/lib/trade/trade-value';
import type { TradeCard } from '@/lib/trade/trades-client';
import type { EnrichedCard } from '@/types/index';
import { toast } from '@/store/toasts';
import { Button } from '@/components/shared/Button';
import { PrintingChoices } from './PrintingChoices';
import { ThumbButton } from './ReviewThumb';
import { TradePreviewCarousel, type TradePreviewState } from './TradePreviewCarousel';
import { TradeSheetShell } from './TradeReviewSheet';

/** One card the offer asks for, paired with what the viewer actually owns. */
export interface AcceptChoice {
  /** The line as asked: oracle-level name + quantity. */
  asked: TradeCard;
  /** Every copy the viewer holds of it, right now. */
  line: OwnedTradeLine;
}

function keyOf(card: { oracleId: string; name: string }): string {
  return card.oracleId || `name:${card.name.toLowerCase()}`;
}

/** `7ED #253`, with the finish when it isn't plain. */
function printingLabel(p: { setCode: string; collectorNumber: string; finish: string }): string {
  const base = `${p.setCode.toUpperCase()} #${p.collectorNumber}`;
  return p.finish !== 'nonfoil' ? `${base} ${p.finish}` : base;
}

/**
 * Set and number for printings an ask named. The viewer may own none of them,
 * so a printing they hold is read off their own copy and the rest are looked up
 * by id; until a lookup lands (or when it fails) the note says "a printing you
 * don't have".
 */
function useAskedLabels(refs: readonly PrintingRef[], owned: readonly EnrichedCard[]) {
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const ownedIds = new Set(owned.map((c) => c.scryfallId));
  const needed = [...new Set(refs.map((r) => r.scryfallId))].filter(
    (id) => !ownedIds.has(id) && !(id in fetched)
  );
  const neededKey = needed.join(',');
  useEffect(() => {
    let alive = true;
    for (const id of neededKey ? neededKey.split(',') : []) {
      getCardById(id)
        .then((card) => {
          if (alive && card) {
            setFetched((prev) => ({
              ...prev,
              [id]: `${card.set.toUpperCase()} #${card.collector_number}`,
            }));
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [neededKey]);
  return (ref: PrintingRef): string | null => {
    const own = owned.find((c) => c.scryfallId === ref.scryfallId);
    if (own) return printingLabel({ ...own, finish: ref.finish });
    const label = fetched[ref.scryfallId];
    return label ? (ref.finish !== 'nonfoil' ? `${label} ${ref.finish}` : label) : null;
  };
}

interface Props {
  /** Who sent the offer: display name or @handle. */
  who: string;
  note: string;
  /** What they get from you, as asked (oracle-level). */
  asks: TradeCard[];
  /** What you get, read-only. */
  receive: TradeCard[];
  /** The receive side's worth, already priced by the offer row. */
  receiveValue: SideValue;
  /** Asked cards resolved to copies you own right now. */
  choices: AcceptChoice[];
  /** Asked cards you no longer have enough of. */
  missing: string[];
  busy: boolean;
  onClose: () => void;
  onAccept: (resolved: TradeCard[]) => void;
  onDecline: () => void;
  onCounter?: () => void;
}

/**
 * Answering an offer: one sheet that shows the whole deal before anything
 * touches the collection.
 *
 * Accepting removes copies from this device's binders the moment it lands, so
 * it is never one tap from a list row. The review pre-fills the exact
 * cheapest-first pick the old one-tap path sent, so confirming changes nothing
 * and adjusting a printing is a deliberate override. It also says up front what
 * the settlement toast used to say afterwards: which of your decks lose a card.
 * The printing chooser is the shared `PrintingChoices`, inline, so the sheet's
 * body is the only scroll region.
 */
export function TradeIncomingReview({
  who,
  note,
  asks,
  receive,
  receiveValue,
  choices,
  missing,
  busy,
  onClose,
  onAccept,
  onDecline,
  onCounter,
}: Props) {
  const hintId = useId();
  // Once for the sheet: an offer can name several cards, and each printing
  // list would otherwise re-materialize the whole collection.
  const binderByCopyId = useBinderByCopyId();
  const allocations = useAllocations();
  const locations = useCardLocations(receive.length > 0).byOracleId;

  // Stable for the life of the sheet: it opens over a snapshot, and
  // re-grouping mid-choice (a sync landing) would reshuffle rows under a thumb.
  const claimed = useMemo(() => new Set(allocations.keys()), [allocations]);
  const groupsByKey = useMemo(() => {
    const map = new Map<string, PrintingGroup[]>();
    for (const choice of choices) {
      map.set(keyOf(choice.asked), groupByPrinting(choice.line, claimed));
    }
    return map;
  }, [choices, claimed]);

  const [counts, setCounts] = useState<Record<string, PrintingCounts>>(() => {
    const seeded: Record<string, PrintingCounts> = {};
    for (const choice of choices) {
      // The printings the ask named come first (a free copy before a deck's);
      // what the viewer lacks of them is filled with the cheapest free copy.
      seeded[keyOf(choice.asked)] = defaultPrintingCounts(choice.line, choice.asked.quantity, {
        claimed,
        prefer: choice.asked.copies,
      });
    }
    return seeded;
  });
  const [preview, setPreview] = useState<TradePreviewState | null>(null);

  function setPrinting(cardKey: string, printingKey: string, next: number, target: number) {
    const groups = groupsByKey.get(cardKey);
    if (!groups) return;
    setCounts((prev) => ({
      ...prev,
      [cardKey]: setPrintingCountBalanced(groups, prev[cardKey] ?? {}, printingKey, next, target),
    }));
  }

  const resolved = choices.map((choice) => {
    const cardKey = keyOf(choice.asked);
    const groups = groupsByKey.get(cardKey) ?? [];
    const copies = copiesFromCounts(groups, counts[cardKey] ?? {});
    // Settlement spends a printing's free copies before one a deck holds, so a
    // deck only loses a card when the pick outnumbers the free ones.
    const deckNames: string[] = [];
    for (const group of groups) {
      const picked = copies.filter((c) => group.copies.some((g) => g.copyId === c.copyId)).length;
      const held = group.copies.filter((c) => allocations.has(c.copyId));
      const overflow = picked - (group.copies.length - held.length);
      for (const c of held.slice(0, Math.max(0, overflow))) {
        const owner = allocations.get(c.copyId)?.ownerName;
        if (owner && !deckNames.includes(owner)) deckNames.push(owner);
      }
    }
    const shortfall = printingShortfall(choice.asked.copies, copies);
    return { choice, cardKey, groups, copies, deckNames, shortfall };
  });

  const labelOf = useAskedLabels(
    resolved.flatMap((r) => r.shortfall?.missed ?? []),
    resolved.flatMap((r) => r.choice.line.copies)
  );

  // The server checks the resolved side against the ask, so a short line would
  // be rejected there anyway. Catching it here keeps the reason legible.
  const short = resolved.filter((r) => r.copies.length !== r.choice.asked.quantity);
  const giveValue = resolved.reduce((sum, r) => sum + sumCopyValue(r.copies), 0);
  const net = describeNet({ text: '', amount: giveValue, estimate: false }, receiveValue);
  const giveCount = asks.reduce((n, c) => n + c.quantity, 0);
  const getCount = receive.reduce((n, c) => n + c.quantity, 0);

  const blocked =
    missing.length > 0
      ? `You no longer have ${missing.join(', ')} to give. Counter instead, or decline.`
      : short.length > 0
        ? `Pick ${short[0].choice.asked.quantity} ${
            short[0].choice.asked.quantity === 1 ? 'copy' : 'copies'
          } of ${short[0].choice.asked.name} to continue.`
        : null;

  function accept() {
    if (blocked || busy) return;
    onAccept(resolved.map((r) => toTradeCardFromCopies(r.choice.line, r.copies)));
  }

  // Tapping any thumb opens the carousel across the whole deal, give then get.
  async function inspect(tapped: TradeCard) {
    const { cards, indexOf } = await resolveTradePreview([...asks, ...receive]);
    if (cards.length === 0) {
      toast.show({ message: "Couldn't load these cards right now.", tone: 'warn' });
      return;
    }
    const at = indexOf(tapped);
    setPreview({ cards, index: at >= 0 ? at : 0 });
  }

  return (
    <TradeSheetShell title={`Offer from ${who}`} onClose={onClose} dismissable={!busy}>
      <div className="trade-review trade-incoming">
        <div className="trade-review-body">
          {note && <p className="trade-incoming-note">“{note}”</p>}

          <section className="trade-review-side" aria-label="You give">
            <h3 className="trade-review-side-title">
              <span>You give · {giveCount}</span>
              {missing.length === 0 && (
                <span className="trade-review-side-value">{formatMoney(giveValue)}</span>
              )}
            </h3>
            <ul className="trade-incoming-cards">
              {resolved.map(({ choice, cardKey, groups, copies, deckNames, shortfall }) => {
                const asked = choice.asked.quantity;
                return (
                  <li key={cardKey} className="trade-incoming-card">
                    <div className="trade-review-line">
                      <ThumbButton
                        name={choice.asked.name}
                        src={copies[0]?.imageSmall ?? copies[0]?.imageNormal}
                        onClick={() => void inspect(choice.asked)}
                      />
                      <span className="trade-review-info">
                        <span className="trade-review-name" title={choice.asked.name}>
                          {choice.asked.name}
                        </span>
                        <span
                          className={
                            copies.length === asked
                              ? 'trade-review-meta'
                              : 'trade-review-meta is-warn'
                          }
                          role="status"
                        >
                          {copies.length} of {asked} chosen
                        </span>
                      </span>
                      <span className="trade-incoming-value">
                        {formatMoney(sumCopyValue(copies))}
                      </span>
                    </div>
                    {/* One printing owned: nothing to decide, so the list drops
                        its steppers and reads as a receipt. Still shown, since
                        seeing exactly what leaves is the point. */}
                    <PrintingChoices
                      cardName={choice.asked.name}
                      groups={groups}
                      countOf={(group) => counts[cardKey]?.[group.key] ?? 0}
                      onSet={
                        groups.length === 1
                          ? undefined
                          : (printingKey, next) => setPrinting(cardKey, printingKey, next, asked)
                      }
                      disabled={busy}
                      binderByCopyId={binderByCopyId}
                      label={`${choice.asked.name}: your printings`}
                    />
                    {shortfall && (
                      <p className="trade-review-meta trade-incoming-swap" role="status">
                        {who} asked for{' '}
                        {shortfall.missed
                          .map((m) => labelOf(m) ?? "a printing you don't have")
                          .join(', ')}
                        ; you&apos;re giving {shortfall.given.map(printingLabel).join(', ')}.
                      </p>
                    )}
                    {deckNames.length > 0 && (
                      <p className="trade-incoming-deck" role="status">
                        {choice.asked.name} is in {deckNames.join(' and ')}. Accepting leaves{' '}
                        {deckNames.length === 1 ? 'that deck' : 'those decks'} one card short.
                      </p>
                    )}
                  </li>
                );
              })}
              {missing.map((name) => (
                <li key={`missing:${name}`} className="trade-incoming-card">
                  <p className="trade-incoming-deck" role="status">
                    You no longer have {name} to give.
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="trade-review-side" aria-label="You get">
            <h3 className="trade-review-side-title">
              <span>You get · {getCount}</span>
              {receiveValue.text && (
                <span className="trade-review-side-value">{receiveValue.text}</span>
              )}
            </h3>
            {receive.length === 0 ? (
              <p className="trade-incoming-nothing">Nothing</p>
            ) : (
              <ul className="trade-review-lines" aria-label="You get: cards">
                {receive.map((card) => {
                  const where = card.oracleId ? locations.get(card.oracleId) : undefined;
                  return (
                    <li key={card.oracleId || card.name} className="trade-review-line">
                      <ThumbButton name={card.name} onClick={() => void inspect(card)} />
                      <span className="trade-review-info">
                        <span className="trade-review-name" title={card.name}>
                          {card.name}
                          {card.quantity > 1 && ` ×${card.quantity}`}
                        </span>
                        {where && (
                          <span className="trade-review-meta">
                            Files next to your copy in{' '}
                            {formatLocation({
                              binderName: where.binderName,
                              pageNum: where.pageNum,
                              volume: where.volume,
                            })}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="trade-review-foot">
          {net && (
            <p className="trade-review-net" aria-live="polite">
              {net}
            </p>
          )}
          <Button
            variant="primary"
            className="trade-review-send"
            disabled={blocked !== null || busy}
            aria-describedby={blocked ? hintId : undefined}
            onClick={accept}
          >
            {busy ? 'Accepting…' : 'Accept trade'}
          </Button>
          <div className="trade-incoming-actions">
            {onCounter && (
              <Button disabled={busy} onClick={onCounter}>
                Counter
              </Button>
            )}
            <Button variant="danger" disabled={busy} onClick={onDecline}>
              Decline
            </Button>
          </div>
          <p className="trade-review-hint" id={hintId}>
            {blocked ??
              `${who} gets the exact printings above. They leave your collection when you accept.`}
          </p>
        </footer>

        {preview && (
          <TradePreviewCarousel
            state={preview}
            onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </TradeSheetShell>
  );
}

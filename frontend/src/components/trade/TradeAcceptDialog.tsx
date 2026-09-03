import './TradeAcceptDialog.css';
import { useId, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useCardThumb } from '../../lib/card-thumbs';
import { formatMoney } from '../../lib/format-money';
import { PrintingChoices } from './PrintingChoices';
import { useBinderByCopyId } from '../../lib/use-binder-by-copy';
import { resolveTradePreview } from '../../lib/trade-preview';
import { TradePreviewCarousel, type TradePreviewState } from './TradePreviewCarousel';
import { toast } from '../../store/toasts';
import {
  groupByPrinting,
  defaultPrintingCounts,
  setPrintingCountBalanced,
  copiesFromCounts,
  toTradeCardFromCopies,
  sumCopyValue,
  type OwnedTradeLine,
  type PrintingCounts,
  type PrintingGroup,
} from '../../lib/trade-picker';
import type { TradeCard } from '../../lib/trades-client';

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

interface Props {
  /** Who is getting these cards — the sentence needs a name, not "them". */
  counterpartyName: string;
  choices: AcceptChoice[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (resolved: TradeCard[]) => void;
}

/**
 * Choosing which of your physical copies leave when you ACCEPT an offer.
 *
 * The composer has always let the proposer pick printings; accepting auto-picked
 * cheapest-first and never asked. That asymmetry meant the person answering an
 * offer — the one whose cards are about to be removed — had the least say over
 * which ones. This closes it.
 *
 * It only opens when there is genuinely something to choose (see the caller's
 * `needsChoice`): most cards exist in one printing, and an offer for those still
 * settles in a single tap. When it does open it is pre-filled with the exact
 * cheapest-first pick the unattended path would have sent, so confirming changes
 * nothing and adjusting is a deliberate override — the dialog is a confirm step
 * for a collection-mutating action first, and a picker second.
 */
export function TradeAcceptDialog({ counterpartyName, choices, busy, onCancel, onConfirm }: Props) {
  const titleId = useId();
  // Once for the dialog — an offer can name several cards, and each of their
  // printing lists would otherwise re-materialize the whole collection.
  const binderByCopyId = useBinderByCopyId();

  // Grouping is stable for the life of the dialog: it opens over a snapshot of
  // the collection, and re-grouping mid-choice (a background sync landing) would
  // reshuffle the rows under the user's finger.
  const groupsByKey = useMemo(() => {
    const map = new Map<string, PrintingGroup[]>();
    for (const choice of choices) map.set(keyOf(choice.asked), groupByPrinting(choice.line));
    return map;
  }, [choices]);

  const [counts, setCounts] = useState<Record<string, PrintingCounts>>(() => {
    const seeded: Record<string, PrintingCounts> = {};
    for (const choice of choices) {
      seeded[keyOf(choice.asked)] = defaultPrintingCounts(choice.line, choice.asked.quantity);
    }
    return seeded;
  });

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
    return { choice, cardKey, groups, copies };
  });

  // Every line must name exactly as many copies as were asked for — the server
  // validates the resolved side against the ask, so a short line would be
  // rejected there anyway. Catching it here keeps the reason legible.
  const short = resolved.filter((r) => r.copies.length !== r.choice.asked.quantity);
  const totalValue = resolved.reduce((sum, r) => sum + sumCopyValue(r.copies), 0);

  function confirm() {
    if (short.length > 0 || busy) return;
    onConfirm(resolved.map((r) => toTradeCardFromCopies(r.choice.line, r.copies)));
  }

  // Tapping any card head opens the carousel across every card being asked
  // for, in order — this dialog IS one decision about a set of cards, the same
  // reasoning that makes an offer's chips span the whole offer.
  const [preview, setPreview] = useState<TradePreviewState | null>(null);

  async function inspect(tapped: TradeCard) {
    const asked = choices.map((c) => c.asked);
    const { cards, indexOf } = await resolveTradePreview(asked);
    if (cards.length === 0) {
      toast.show({ message: "Couldn't load these cards right now.", tone: 'warn' });
      return;
    }
    const at = indexOf(tapped);
    setPreview({ cards, index: at >= 0 ? at : 0 });
  }

  return (
    <>
      <Modal onClose={onCancel} labelledBy={titleId} dismissable={!busy} className="choice-dialog">
        <div className="trade-accept">
          <h2 id={titleId} className="choice-dialog-title">
            Which copies are you giving?
          </h2>
          <p className="choice-dialog-body">
            {counterpartyName} gets the exact printings you pick here, and they leave your
            collection as soon as you accept.
          </p>

          <ul className="trade-accept-list">
            {resolved.map(({ choice, cardKey, groups, copies }) => {
              const asked = choice.asked.quantity;
              const chosen = copies.length;
              return (
                <li key={cardKey} className="trade-accept-card">
                  <div className="trade-accept-card-head">
                    {/* Nothing else on the head claims this click — the steppers
                      live in the printing rows below — so the preview is
                      purely additive. Read-only: this dialog confirms a deal,
                      it doesn't pick new cards. */}
                    <button
                      type="button"
                      className="trade-accept-thumb-btn"
                      aria-label={`Preview ${choice.asked.name}`}
                      title="Preview card"
                      onClick={() => void inspect(choice.asked)}
                    >
                      <AcceptThumb name={choice.asked.name} />
                    </button>
                    <span className="trade-accept-card-info">
                      <span className="trade-accept-card-name" title={choice.asked.name}>
                        {choice.asked.name}
                      </span>
                      <span
                        className={
                          chosen === asked
                            ? 'trade-accept-card-count'
                            : 'trade-accept-card-count is-short'
                        }
                        role="status"
                      >
                        {chosen} of {asked} chosen
                      </span>
                    </span>
                    <span className="trade-accept-card-value">
                      {formatMoney(sumCopyValue(copies))}
                    </span>
                  </div>

                  {/* One printing owned: nothing to decide, so the list drops its
                    steppers and reads as a receipt. Still shown — the point of
                    the dialog is seeing exactly what leaves. */}
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
                    label={`${choice.asked.name} — your printings`}
                  />
                </li>
              );
            })}
          </ul>

          <p className="trade-accept-total">
            <span>You're giving</span>
            <span className="trade-accept-total-value">{formatMoney(totalValue)}</span>
          </p>

          <div className="choice-dialog-actions trade-accept-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirm}
              disabled={short.length > 0 || busy}
            >
              {busy ? 'Accepting…' : 'Accept trade'}
            </button>
          </div>
          {short.length > 0 && (
            // Names the card rather than saying "fix the selection" — with several
            // cards in one offer, "which one" is the only useful part.
            <p className="trade-accept-gate" role="status">
              Pick {short[0].choice.asked.quantity}{' '}
              {short[0].choice.asked.quantity === 1 ? 'copy' : 'copies'} of{' '}
              {short[0].choice.asked.name} to continue.
            </p>
          )}
        </div>
      </Modal>

      {preview && (
        <TradePreviewCarousel
          state={preview}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function AcceptThumb({ name }: { name: string }) {
  const thumb = useCardThumb(name, 'small');
  return thumb ? (
    <img
      className="trade-accept-thumb"
      src={thumb}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="trade-accept-thumb is-placeholder" aria-hidden />
  );
}

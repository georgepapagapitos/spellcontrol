import './TradeReview.css';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/shared/Button';
import { useBinderByCopyId } from '@/lib/binder/use-binder-by-copy';
import { formatMoney } from '@/lib/collection/format-money';
import type { PublicCard } from '@/lib/social/shared-types';
import { groupByPrinting, sumCopyValue, type PrintingGroup } from '@/lib/trade/trade-picker';
import { keyOf } from '@/lib/trade/trade-basket';
import { resolveTradePreview } from '@/lib/trade/trade-preview';
import {
  MAX_TRADE_LINES_PER_SIDE,
  type TradeCard,
  type TradeOffer,
} from '@/lib/trade/trades-client';
import {
  useTradeReview,
  type ReviewGetLine,
  type ReviewGiveLine,
} from '@/lib/trade/use-trade-review';
import { useSendTrade } from '@/lib/trade/use-send-trade';
import { toast } from '@/store/toasts';
import { PrintingChoices, describePrinting } from './PrintingChoices';
import { ThumbButton } from './ReviewThumb';
import { TradePreviewCarousel, type TradePreviewState } from './TradePreviewCarousel';

export interface TradeReviewProps {
  friendId: string;
  /** How to refer to the friend in copy: display name or @handle. */
  friendName: string;
  /** Their cards, copy by copy. Null while loading or when their collection is private. */
  theirCards: readonly PublicCard[] | null;
  /** What the friend is looking for; marks the give side. */
  friendWants?: ReadonlyArray<{ oracleId?: string | null; name: string }> | null;
  /** Opens the browser on their cards. */
  onAddMore: () => void;
  /** Opens the browser on the viewer's own cards. */
  onAddFromYours: () => void;
  onSent: (offer: TradeOffer) => void;
  className?: string;
}

/**
 * The body of a trade review for one friend: what you get, what you give,
 * a note, and the net with Send pinned underneath.
 *
 * Layout contract: this renders a flex column that fills its host
 * (`TradeReviewSheet` or `TradeDock`). The middle is the ONE scroll region and
 * the footer (net + Send) never scrolls, so a host supplies its own header and
 * nothing else. No scroll area lives inside this one: the inline printing
 * chooser grows the list instead.
 */
export function TradeReview({
  friendId,
  friendName,
  theirCards,
  friendWants,
  onAddMore,
  onAddFromYours,
  onSent,
  className,
}: TradeReviewProps) {
  const m = useTradeReview({ friendId, friendName, theirCards, friendWants });
  const noteId = useId();
  const [noteOpen, setNoteOpen] = useState(() => (m.draft?.note ?? '') !== '');
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<TradePreviewState | null>(null);
  const sentRef = useRef(false);

  const { sending, send } = useSendTrade({
    friendId,
    friendName,
    counterTo: m.draft?.counterTo,
    onSent: (offer) => {
      sentRef.current = true;
      onSent(offer);
    },
  });

  const canSend = !sending && m.blockedReason === null;

  async function doSend() {
    if (!canSend || !m.draft) return;
    setFailed(false);
    sentRef.current = false;
    await send({ give: m.giveCards, receive: m.wantCards, note: m.draft.note });
    // The hook toasts and keeps the draft on failure; it only says so by not
    // calling onSent, so the banner keys off that.
    if (!sentRef.current) setFailed(true);
  }

  /** A row's thumb opens the whole deal, give then get. `indexOf` maps back:
   *  a card that resolved nowhere is dropped, so position would drift. */
  async function inspect(tapped: TradeCard | undefined) {
    const all = [...m.giveCards, ...m.wantCards];
    const { cards, indexOf } = await resolveTradePreview(all);
    if (cards.length === 0) {
      toast.show({ message: "Couldn't load these cards right now.", tone: 'warn' });
      return;
    }
    const at = tapped ? indexOf(tapped) : -1;
    setPreview({ cards, index: at >= 0 ? at : 0 });
  }

  const goneIssues = m.issues.filter((i) => i.kind === 'gone');
  const reduced = m.issues.filter((i) => i.kind === 'reduced');
  const counterTo = m.draft?.counterTo;
  const getFull = m.getLineCount >= MAX_TRADE_LINES_PER_SIDE;
  const giveFull = m.giveLineCount >= MAX_TRADE_LINES_PER_SIDE;
  const empty = m.getLineCount === 0 && m.giveLineCount === 0;

  return (
    <div className={className ? `trade-review ${className}` : 'trade-review'}>
      <div className="trade-review-body">
        {counterTo && (
          <Banner tone="info">
            Countering {counterTo.name}&apos;s offer. Sending this declines theirs.
          </Banner>
        )}
        {goneIssues.map((issue) => (
          <Banner
            key={issue.key}
            tone="warn"
            action={
              <Button variant="link" disabled={sending} onClick={() => m.removeGet(issue.key)}>
                Remove
              </Button>
            }
          >
            {issue.name} left {friendName}&apos;s collection since you added it.
          </Banner>
        ))}
        {reduced.length > 0 && (
          <Banner tone="info">
            Changed to match what {friendName} has now: {reduced.map((i) => i.name).join(', ')}.
          </Banner>
        )}
        {m.droppedGive.length > 0 && (
          <Banner tone="info">
            Taken out because you no longer own {m.droppedGive.length === 1 ? 'it' : 'them'}:{' '}
            {m.droppedGive.join(', ')}.
          </Banner>
        )}
        {(getFull || giveFull) && (
          <Banner tone="warn">
            A trade can hold {MAX_TRADE_LINES_PER_SIDE} different cards per side. Send this one and
            start another.
          </Banner>
        )}

        <Side title="You get" count={m.getCount} value={m.getLineCount > 0 ? m.getSide.text : ''}>
          {m.getLineCount === 0 ? (
            <EmptySide
              text={`Nothing from ${friendName} yet.`}
              action={`Pick from ${friendName}'s cards`}
              onAction={onAddMore}
              disabled={sending}
            />
          ) : (
            <>
              <ul className="trade-review-lines" aria-label="You get: chosen cards">
                {m.getLines.map((line) => (
                  <GetLine
                    key={line.key}
                    line={line}
                    friendName={friendName}
                    disabled={sending}
                    onInspect={() => void inspect(m.wantCards.find((c) => c.oracleId === line.key))}
                    onQuantity={(q) => m.setGetQuantity(line.key, q)}
                    onRemove={() => m.removeGet(line.key)}
                  />
                ))}
              </ul>
              <AddMore
                label={`Add more of ${friendName}'s cards`}
                onClick={onAddMore}
                disabled={sending || getFull}
              />
            </>
          )}
        </Side>

        <Side
          title="You give"
          count={m.giveCount}
          value={m.giveLineCount > 0 && !m.giveLoading ? m.giveSide.text : ''}
        >
          {m.giveLoading ? (
            <div
              className="trade-review-skeleton"
              role="status"
              aria-busy="true"
              aria-label="Getting your cards…"
            />
          ) : m.giveLineCount === 0 ? (
            <EmptySide
              text="Nothing from you yet. You can send an ask on its own."
              action="Pick from your cards"
              onAction={onAddFromYours}
              disabled={sending}
            />
          ) : (
            <>
              <ul className="trade-review-lines" aria-label="You give: chosen cards">
                {m.giveLines.map((line) => (
                  <GiveLine
                    key={line.key}
                    line={line}
                    friendName={friendName}
                    disabled={sending}
                    onInspect={() => void inspect(m.giveCards.find((c) => keyOf(c) === line.key))}
                    onSetPrinting={(printingKey, next) =>
                      m.setPrinting(line.key, printingKey, next)
                    }
                    onRemove={() => m.removeGive(line.key)}
                  />
                ))}
              </ul>
              <AddMore
                label="Add from your cards"
                onClick={onAddFromYours}
                disabled={sending || giveFull}
              />
            </>
          )}
        </Side>

        {!empty && (
          <div className="trade-review-note">
            {noteOpen ? (
              <>
                <label htmlFor={noteId} className="trade-review-note-label">
                  Note <span className="trade-review-optional">(optional)</span>
                </label>
                <textarea
                  id={noteId}
                  className="trade-review-note-input"
                  value={m.draft?.note ?? ''}
                  maxLength={500}
                  rows={2}
                  placeholder="Bring these Thursday?"
                  disabled={sending}
                  onChange={(e) => m.setNote(e.target.value)}
                />
              </>
            ) : (
              <button
                type="button"
                className="trade-review-note-toggle"
                onClick={() => setNoteOpen(true)}
              >
                <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
                Add a note
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="trade-review-foot">
        {failed && (
          <Banner
            tone="error"
            role="alert"
            action={
              <Button variant="link" disabled={!canSend} onClick={() => void doSend()}>
                Retry
              </Button>
            }
          >
            Couldn&apos;t send. Your trade is saved as a draft.
          </Banner>
        )}
        {m.net && (
          <p className="trade-review-net" aria-live="polite">
            {m.net}
          </p>
        )}
        <Button
          variant="primary"
          className="trade-review-send"
          onClick={() => void doSend()}
          disabled={!canSend}
          aria-describedby={m.blockedReason ? `${noteId}-hint` : undefined}
        >
          {sending ? 'Sending…' : 'Send offer'}
        </Button>
        <p className="trade-review-hint" id={`${noteId}-hint`}>
          {m.blockedReason && !sending
            ? m.blockedReason
            : `${friendName} picks exact printings when they accept. Closing keeps this as a draft.`}
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
  );
}

function Banner({
  tone,
  role,
  action,
  children,
}: {
  tone: 'info' | 'warn' | 'error';
  role?: 'alert' | 'status';
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`trade-review-banner is-${tone}`} role={role ?? 'status'}>
      <span className="trade-review-banner-text">{children}</span>
      {action}
    </div>
  );
}

function Side({
  title,
  count,
  value,
  children,
}: {
  title: string;
  count: number;
  value: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="trade-review-side" aria-labelledby={id}>
      <h3 className="trade-review-side-title">
        <span id={id}>
          {title}
          {count > 0 && <> · {count}</>}
        </span>
        {value && <span className="trade-review-side-value">{value}</span>}
      </h3>
      {children}
    </section>
  );
}

function EmptySide({
  text,
  action,
  onAction,
  disabled,
}: {
  text: string;
  action: string;
  onAction: () => void;
  disabled: boolean;
}) {
  return (
    <div className="trade-review-empty">
      <p>{text}</p>
      <AddMore label={action} onClick={onAction} disabled={disabled} />
    </div>
  );
}

function AddMore({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button className="trade-review-add" onClick={onClick} disabled={disabled}>
      <Plus width={16} height={16} aria-hidden />
      {label}
    </Button>
  );
}

function GetLine({
  line,
  friendName,
  disabled,
  onInspect,
  onQuantity,
  onRemove,
}: {
  line: ReviewGetLine;
  friendName: string;
  disabled: boolean;
  onInspect: () => void;
  onQuantity: (next: number) => void;
  onRemove: () => void;
}) {
  const meta = line.gone
    ? `${friendName} no longer has this`
    : [
        line.theirCount != null ? `${friendName} has ${line.theirCount}` : null,
        line.floor != null ? `from ${formatMoney(line.floor * line.quantity)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <li className="trade-review-line">
      <ThumbButton name={line.name} onClick={onInspect} />
      <span className="trade-review-info">
        <span className="trade-review-name" title={line.name}>
          {line.name}
        </span>
        {meta && (
          <span className={line.gone ? 'trade-review-meta is-warn' : 'trade-review-meta'}>
            {meta}
          </span>
        )}
      </span>
      {!line.gone && (
        <span className="trade-review-stepper">
          <IconButton
            className="trade-review-step"
            label={`One fewer ${line.name}`}
            icon={<Minus width={14} height={14} strokeWidth={1.8} />}
            disabled={disabled || line.quantity <= 1}
            onClick={() => onQuantity(line.quantity - 1)}
          />
          <span className="trade-review-count" aria-live="polite">
            {line.quantity}
          </span>
          <IconButton
            className="trade-review-step"
            label={`One more ${line.name}`}
            icon={<Plus width={14} height={14} strokeWidth={1.8} />}
            disabled={disabled || line.quantity >= line.max}
            onClick={() => onQuantity(line.quantity + 1)}
          />
        </span>
      )}
      <IconButton
        className="trade-review-remove"
        label={`Remove ${line.name} from the trade`}
        icon={<X width={14} height={14} strokeWidth={1.8} />}
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}

function GiveLine({
  line,
  friendName,
  disabled,
  onInspect,
  onSetPrinting,
  onRemove,
}: {
  line: ReviewGiveLine;
  friendName: string;
  disabled: boolean;
  onInspect: () => void;
  onSetPrinting: (printingKey: string, next: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const groups = line.line ? groupByPrinting(line.line) : [];
  const countIn = (g: PrintingGroup) => g.copies.filter((c) => line.chosenIds.has(c.copyId)).length;
  const inTrade = groups.filter((g) => countIn(g) > 0);
  const chosen = line.line?.copies.filter((c) => line.chosenIds.has(c.copyId)) ?? [];
  const printing =
    inTrade
      .map((g) => (countIn(g) > 1 ? `${describePrinting(g)} ×${countIn(g)}` : describePrinting(g)))
      .join(' + ') || 'Printing unavailable';
  const price = chosen.length > 0 ? ` · ${formatMoney(sumCopyValue(chosen))}` : '';
  return (
    <li className="trade-review-line-wrap">
      <div className="trade-review-line">
        <ThumbButton
          name={line.name}
          src={chosen[0]?.imageSmall ?? chosen[0]?.imageNormal}
          onClick={onInspect}
        />
        <span className="trade-review-info">
          <span className="trade-review-name-row">
            <span className="trade-review-name" title={line.name}>
              {line.name}
            </span>
            {line.wanted && <span className="trade-review-wanted">{friendName} wants</span>}
          </span>
          {line.line ? (
            <button
              type="button"
              className="trade-review-printing"
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`Choose which printing of ${line.name} to trade. Now ${printing}`}
              disabled={disabled}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="trade-review-printing-text">
                {printing}
                {price}
              </span>
              <ChevronDown
                width={14}
                height={14}
                strokeWidth={1.8}
                aria-hidden
                className={open ? 'trade-review-chevron is-open' : 'trade-review-chevron'}
              />
            </button>
          ) : (
            <span className="trade-review-meta is-warn">You no longer own this</span>
          )}
          {line.note && (
            <span className={line.inDeck ? 'trade-review-meta is-warn' : 'trade-review-meta'}>
              {line.note}
            </span>
          )}
        </span>
        <IconButton
          className="trade-review-remove"
          label={`Remove ${line.name} from the trade`}
          icon={<X width={14} height={14} strokeWidth={1.8} />}
          disabled={disabled}
          onClick={onRemove}
        />
      </div>
      {open && line.line && (
        <div className="trade-review-printings" id={listId}>
          <OpenPrintings
            name={line.name}
            groups={groups}
            countIn={countIn}
            disabled={disabled}
            onSet={onSetPrinting}
          />
        </div>
      )}
    </li>
  );
}

/** Mounted only while a line is open, so the binder lookup (which walks the
 *  whole collection) is paid for by the one person who asked. */
function OpenPrintings({
  name,
  groups,
  countIn,
  disabled,
  onSet,
}: {
  name: string;
  groups: PrintingGroup[];
  countIn: (g: PrintingGroup) => number;
  disabled: boolean;
  onSet: (printingKey: string, next: number) => void;
}) {
  const binderByCopyId = useBinderByCopyId();
  return (
    <PrintingChoices
      cardName={name}
      groups={groups}
      countOf={countIn}
      onSet={onSet}
      disabled={disabled}
      binderByCopyId={binderByCopyId}
      label={`${name}: your printings`}
    />
  );
}

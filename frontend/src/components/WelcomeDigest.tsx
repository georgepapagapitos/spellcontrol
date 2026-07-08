import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, History, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '../lib/format-money';
import { formatDayKey, dayKey } from '../lib/value-history';
import {
  buildWelcomeDigest,
  getDigestBaseline,
  isDigestDismissedThisSession,
  markDigestDismissedThisSession,
  setDigestBaseline,
  type WelcomeDigest as Digest,
} from '../lib/welcome-digest';
import { useEscapeKey } from '../lib/use-escape-key';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useAnimatedNumber } from '../lib/use-animated-number';
import { useSheetExit } from '../lib/use-sheet-exit';
import './WelcomeDigest.css';

const UNCAT = 'Uncategorized';

type DeltaDirection = 'up' | 'down' | 'flat';

function deltaDirection(amount: number): DeltaDirection {
  const whole = Math.round(amount);
  return whole > 0 ? 'up' : whole < 0 ? 'down' : 'flat';
}

/** "+$18" / "−$4" / "Steady" — whole dollars, typographic minus. */
function deltaText(amount: number): string {
  const whole = Math.round(amount);
  if (whole === 0) return 'Steady';
  return `${whole > 0 ? '+' : '−'}${formatMoney(Math.abs(whole), { wholeDollars: true })}`;
}

function WelcomeDigestSheet({
  digest,
  currentValue,
  openedToday,
  onGotIt,
  onClose,
}: {
  digest: Digest;
  currentValue: number;
  /** Day key captured when the sheet was opened (render must not read the clock). */
  openedToday: string;
  onGotIt: () => void;
  onClose: () => void;
}): JSX.Element {
  useLockBodyScroll();
  const navigate = useNavigate();

  // Below 1024px this is a bottom sheet with a slide-up entry, so every
  // dismiss path (backdrop, ✕, Escape, "Got it") plays the symmetric
  // `binder-sheet-slide-out` before unmounting; on desktop it's a centered
  // panel with `animation: none`, so dismissal stays instant there (same
  // convention as CardPickerSheet / DeckSizePrompt). "Got it" does extra
  // bookkeeping (re-baseline, dismiss for the session) beyond a plain close,
  // so the pending action is tracked and run once the exit — or the
  // desktop no-op — completes.
  const pendingRef = useRef<() => void>(onClose);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    () => pendingRef.current(),
    'binder-sheet-slide-out'
  );
  const dismiss = useCallback(
    (action: () => void) => {
      pendingRef.current = action;
      if (window.matchMedia('(min-width: 1024px)').matches) action();
      else beginClose();
    },
    [beginClose]
  );
  const close = useCallback(() => dismiss(onClose), [dismiss, onClose]);
  useEscapeKey(close);

  const whole = Math.round(digest.deltaAmount);
  const direction = deltaDirection(digest.deltaAmount);
  const sinceLabel =
    digest.baseline.day === openedToday ? 'earlier today' : formatDayKey(digest.baseline.day);
  // The dollar figure counts up once per baseline (revealKey registry); the
  // direction words stay static per the motion rules. Reduced motion snaps.
  const { display: deltaDisplay } = useAnimatedNumber(Math.abs(whole), {
    revealMs: 600,
    revealKey: whole === 0 ? null : `digest:${digest.baseline.day}`,
  });
  const valueLine =
    whole === 0
      ? 'Value is steady'
      : `Value ${whole > 0 ? 'up' : 'down'} ${formatMoney(deltaDisplay, { wholeDollars: true })}`;

  return (
    <div className="card-picker-root welcome-digest-sheet-root" onClick={close} role="presentation">
      <div
        className={`card-picker-sheet welcome-digest-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Since your last visit"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="welcome-digest-sheet-head">
          <div>
            <h2 className="welcome-digest-sheet-title">Since your last visit</h2>
            <p className="welcome-digest-sheet-sub">
              What the daily price refresh changed — since {sinceLabel}.
            </p>
          </div>
          <button
            type="button"
            className="welcome-digest-sheet-close"
            onClick={close}
            aria-label="Close"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>
        <div className="welcome-digest-sheet-body">
          <p className="welcome-digest-value">
            <span className={`welcome-digest-value-delta welcome-digest-value-delta--${direction}`}>
              {valueLine}
            </span>
            <span className="welcome-digest-value-now">
              Collection is now {formatMoney(Math.floor(currentValue), { wholeDollars: true })}.
            </span>
          </p>
          {digest.moves.length > 0 && (
            <section aria-label="Binder moves">
              <h3 className="welcome-digest-moves-title">
                {digest.moves.length} card{digest.moves.length === 1 ? '' : 's'} moved between
                binders
              </h3>
              <ul className="welcome-digest-moves" role="list">
                {digest.moves.map((m, i) => (
                  <li key={i} className="welcome-digest-move">
                    <span className="welcome-digest-move-name">{m.cardName}</span>
                    <span className="welcome-digest-move-route">
                      {m.fromBinder ?? UNCAT}
                      <ArrowRight width={11} height={11} aria-label="to" />
                      {m.toBinder ?? UNCAT}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="welcome-digest-sheet-actions">
          {digest.moves.length > 0 && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => navigate('/collection/binders')}
            >
              View binders
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => dismiss(onGotIt)}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Welcome-back digest (E76, part 2): one compact strip on the collection page
 * summarizing what changed since the user last caught up — the value delta
 * plus the binder auto-moves whose toasts already fired and vanished (T21) —
 * opening a sheet with the detail. Per the index-page insight-strip ruling:
 * one 44px row, sheet on tap, and NOTHING rendered when there's nothing to
 * say (no baseline yet, dismissed this app-open, or no delta and no moves).
 *
 * "Got it" re-baselines ("caught up as of now") and hides the strip for the
 * rest of the app-open; merely closing the sheet keeps the strip around.
 */
export function WelcomeDigest({
  value,
  refreshing,
}: {
  value: number;
  refreshing: boolean;
}): JSX.Element | null {
  // null = closed; a day key = open, captured at tap time so the sheet never
  // reads the clock during render (react-hooks/purity).
  const [openedToday, setOpenedToday] = useState<string | null>(null);
  const [, bump] = useState(0);

  // First run has no baseline — stamp one silently once pricing has settled
  // (a mid-boot $0 total must not poison the first comparison).
  useEffect(() => {
    if (!refreshing && value > 0 && !getDigestBaseline()) setDigestBaseline(value);
  }, [refreshing, value]);

  const digest = isDigestDismissedThisSession() ? null : buildWelcomeDigest(value);
  // Render-phase adjustment (BetweenYourDecks precedent): if the digest
  // evaporates while the sheet is up, close it before committing the frame.
  if (openedToday !== null && !digest) setOpenedToday(null);
  if (!digest) return null;

  const topMove = digest.moves[digest.moves.length - 1];
  const delta = deltaText(digest.deltaAmount);
  const direction = deltaDirection(digest.deltaAmount);

  const handleGotIt = () => {
    setDigestBaseline(value);
    markDigestDismissedThisSession();
    setOpenedToday(null);
    bump((n) => n + 1);
  };

  return (
    <>
      <button
        type="button"
        className="welcome-digest-strip"
        onClick={() => setOpenedToday(dayKey(Date.now()))}
        aria-haspopup="dialog"
      >
        <History className="welcome-digest-strip-icon" aria-hidden width={16} height={16} />
        <span className="welcome-digest-strip-label">Since your last visit</span>
        {digest.moves.length > 0 && (
          <span className="welcome-digest-strip-count">{digest.moves.length} moved</span>
        )}
        <span className="welcome-digest-strip-teaser">
          <span
            className={`welcome-digest-strip-teaser-delta welcome-digest-strip-teaser-delta--${direction}`}
          >
            {delta}
          </span>
          {topMove && (
            <>
              {' · '}
              {topMove.cardName}
              <ArrowRight
                className="welcome-digest-strip-teaser-arrow"
                aria-hidden
                width={11}
                height={11}
              />
              {topMove.toBinder ?? UNCAT}
            </>
          )}
        </span>
        <ChevronRight className="welcome-digest-strip-chevron" aria-hidden width={16} height={16} />
      </button>
      {openedToday !== null && (
        <WelcomeDigestSheet
          digest={digest}
          currentValue={value}
          openedToday={openedToday}
          onGotIt={handleGotIt}
          onClose={() => setOpenedToday(null)}
        />
      )}
    </>
  );
}

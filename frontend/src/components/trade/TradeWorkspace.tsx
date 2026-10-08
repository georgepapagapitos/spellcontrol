import './TradeWorkspace.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CollectionBrowser } from '@/components/share/CollectionBrowser';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { Tabs, type TabItem } from '@/components/overlays/Tabs';
import { useAllocations } from '@/lib/collection/allocations';
import type { FriendWant } from '@/lib/social/friends-client';
import type { PublicCard } from '@/lib/social/shared-types';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { buildOwnedBrowser } from '@/lib/trade/owned-to-browser';
import { useMyWants } from '@/lib/trade/my-wants';
import type { TradeOffer } from '@/lib/trade/trades-client';
import { useWorkspaceDraft } from '@/lib/trade/use-workspace-draft';
import { DOCK_MIN_WIDTH } from '@/lib/trade/workspace-layout';
import { useElementWidth } from '@/lib/util/use-element-width';
import { useCollectionStore } from '@/store/collection';
import { TradeDock } from './TradeDock';
import { TradeReviewSheet } from './TradeReviewSheet';
import { TradeTray } from './TradeTray';
import { theirSideHooks, useYourSide } from './use-trade-sides';

type Side = 'theirs' | 'yours';

export interface TradeWorkspaceProps {
  friendId: string;
  /** How to refer to the friend in copy: display name or @handle. */
  friendName: string;
  /** Their cards copy by copy. Null until they arrive. */
  theirCards: PublicCard[] | null;
  error?: string | null;
  onRetry: () => void;
  /** They keep their collection private: only the give side can be built. */
  isPrivate: boolean;
  /** What they are looking for; null until known. */
  friendWants: readonly FriendWant[] | null;
  onSent: (offer: TradeOffer) => void;
}

/**
 * Trading while you browse, for one friend: their collection and yours in the
 * same browser, a "+" on every tile, and the draft reviewed in a dock beside
 * the grid or in a tray and sheet, whichever the workspace is wide enough for.
 *
 * Layout: this host is the `@container` (see TradeWorkspace.css); its measured
 * width picks dock or tray against `DOCK_MIN_WIDTH`, the same number the
 * stylesheet's container query uses. `?review=1` opens the review on arrival
 * (the sheet, or focus in the dock) and is then removed.
 */
export function TradeWorkspace({
  friendId,
  friendName,
  theirCards,
  error = null,
  onRetry,
  isPrivate,
  friendWants,
  onSent,
}: TradeWorkspaceProps) {
  const [side, setSide] = useState<Side>('theirs');
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const docked = width >= DOCK_MIN_WIDTH;

  const draft = useWorkspaceDraft({ friendId, friendName, theirCards });
  const myWants = useMyWants();
  const friendWantSet = useMemo(() => {
    const ids = new Set((friendWants ?? []).map((w) => w.oracleId).filter(Boolean));
    return ids.size > 0 ? ids : undefined;
  }, [friendWants]);

  // ── Your cards ────────────────────────────────────────────────────────
  const cards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  const owned = useMemo(() => buildOwnedBrowser(cards, allocations), [cards, allocations]);
  // On a device that has never cached this account the store is empty until
  // the first pull lands; that is "still arriving", never "you own nothing".
  const awaitingFirstPull = useAwaitingFirstPull();
  const yourSide = useYourSide({
    friendName,
    draft,
    model: owned,
    allocations,
    friendWants: friendWantSet,
  });
  const theirTrade = theirSideHooks({ friendName, draft, myWants });

  // ── The review: sheet or dock, opened by ?review=1 ────────────────────
  const [params, setParams] = useSearchParams();
  const reviewParam = params.get('review') === '1';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [arrived, setArrived] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  // Set when the review was asked for; spent once the dock exists to take focus.
  const focusDockRef = useRef(false);
  // Adjusted during render (the documented way to react to a changed value)
  // rather than in an effect, which would cost a frame of the wrong layout.
  if (reviewParam && !arrived) {
    setArrived(true);
    setSheetOpen(true);
  } else if (!reviewParam && arrived) {
    setArrived(false);
  }
  if (docked && sheetOpen) setSheetOpen(false);
  useEffect(() => {
    if (!reviewParam) return;
    focusDockRef.current = true;
    const next = new URLSearchParams(params);
    next.delete('review');
    setParams(next, { replace: true });
  }, [reviewParam, params, setParams]);
  useEffect(() => {
    if (!focusDockRef.current || !docked) return;
    dockRef.current?.focus();
    focusDockRef.current = false;
  }, [docked, reviewParam]);

  const review = {
    friendId,
    friendName,
    theirCards,
    friendWants,
    onAddMore: () => {
      setSide('theirs');
      setSheetOpen(false);
    },
    onAddFromYours: () => {
      setSide('yours');
      setSheetOpen(false);
    },
    onSent: (offer: TradeOffer) => {
      setSheetOpen(false);
      onSent(offer);
    },
  };

  const tabs: TabItem<Side>[] = [
    { id: 'theirs', label: `${friendName}'s cards`, controls: 'trade-workspace-panel' },
    { id: 'yours', label: 'Your cards', controls: 'trade-workspace-panel' },
  ];

  return (
    <div className="trade-workspace" ref={hostRef}>
      <div className={docked ? 'trade-workspace-body is-docked' : 'trade-workspace-body'}>
        <div className="trade-workspace-main">
          <Tabs
            ariaLabel="Whose cards to browse"
            value={side}
            onChange={setSide}
            tabs={tabs}
            className="trade-workspace-switch"
          />
          <div role="tabpanel" id="trade-workspace-panel" aria-labelledby={`sc-tab-${side}`}>
            {side === 'theirs' ? (
              isPrivate ? (
                <EmptyState
                  tagline={`${friendName} keeps their collection private.`}
                  hint="You can still offer cards from yours."
                  actions={<Button onClick={() => setSide('yours')}>Pick from your cards</Button>}
                />
              ) : (
                <CollectionBrowser
                  cards={theirCards}
                  error={error}
                  onRetry={onRetry}
                  errorExit={<Button to="/friends">Back to friends</Button>}
                  ownerName={friendName}
                  viewer="friend"
                  embedded
                  myWants={myWants}
                  trade={theirTrade}
                />
              )
            ) : awaitingFirstPull && owned.rows.length === 0 ? (
              <EmptyState
                status
                tagline="Getting your cards from your other devices…"
                hint={`You can keep picking from ${friendName}'s side.`}
              />
            ) : (
              <CollectionBrowser
                cards={owned.rows}
                ownerName="You"
                viewer="owner"
                embedded
                possessive="your"
                localValues
                myWants={friendWantSet}
                wantsLabel={`${friendName} wants`}
                defaultSort="priority"
                priority={yourSide.priority}
                trade={yourSide.trade}
              />
            )}
          </div>
        </div>
        {docked && (
          <div className="trade-workspace-dock" ref={dockRef} tabIndex={-1}>
            <TradeDock {...review} />
          </div>
        )}
      </div>
      {!docked && (
        <TradeTray
          friendId={friendId}
          friendName={friendName}
          theirCards={theirCards}
          onReview={() => setSheetOpen(true)}
        />
      )}
      {sheetOpen && !docked && <TradeReviewSheet {...review} onClose={() => setSheetOpen(false)} />}
      {yourSide.dialog}
    </div>
  );
}

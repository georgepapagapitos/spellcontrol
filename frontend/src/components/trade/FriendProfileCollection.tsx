import { useNavigate } from 'react-router-dom';
import { CollectionBrowser } from '@/components/share/CollectionBrowser';
import type { PublicCard } from '@/lib/social/shared-types';
import { useMyWants } from '@/lib/trade/my-wants';
import { useWorkspaceDraft } from '@/lib/trade/use-workspace-draft';
import { TradeTray } from './TradeTray';
import { theirSideHooks } from './use-trade-sides';

interface Props {
  friendId: string;
  /** How to refer to the friend in copy. */
  friendName: string;
  cards: PublicCard[] | null;
  error: string | null;
  onRetry: () => void;
}

/**
 * A friend's profile Collection tab with the trade "+" on it. It writes the
 * same saved draft the friend hub's workspace reads, and the tray hands the
 * review to the hub (`?tab=collection&review=1`): the profile has no sheet or
 * dock of its own, the hub is where a trade is built and sent. A stranger's
 * profile never renders this, so a "+" never appears for someone who cannot
 * trade.
 */
export function FriendProfileCollection({ friendId, friendName, cards, error, onRetry }: Props) {
  const navigate = useNavigate();
  const draft = useWorkspaceDraft({ friendId, friendName, theirCards: cards });
  const myWants = useMyWants();
  return (
    <>
      <CollectionBrowser
        cards={cards}
        error={error}
        onRetry={onRetry}
        ownerName={friendName}
        viewer="friend"
        embedded
        myWants={myWants}
        trade={theirSideHooks({ friendName, draft, myWants })}
      />
      <TradeTray
        friendId={friendId}
        friendName={friendName}
        theirCards={cards}
        onReview={() => navigate(`/friends/${friendId}?tab=collection&review=1`)}
      />
    </>
  );
}

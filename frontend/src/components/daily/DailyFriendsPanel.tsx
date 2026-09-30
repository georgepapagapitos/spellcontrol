import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { UserAvatar } from '@/components/profile/UserAvatar';
import { signInPath } from '@/lib/account/sign-in-path';
import { formatIdentity } from '@/lib/social/display-name';
import type { DailyFriend } from '@/lib/daily/daily-client';
import { MAX_GUESSES } from '@/lib/daily/stats';

type Props =
  | { kind: 'guest' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; onRetry: () => void }
  | { kind: 'ready'; friends: readonly DailyFriend[] };

function Score({ friend }: { friend: DailyFriend }) {
  if (!friend.result) return <span className="daily-friend-pending">Not played</span>;
  const { solved, guesses } = friend.result;
  return (
    <span className="daily-friend-score">
      {solved ? `${guesses}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`}
      <span className="sr-only">{solved ? `, solved in ${guesses}` : ', not solved'}</span>
    </span>
  );
}

/**
 * Friends' scores for today. Only counts are shared, never guesses, so the
 * panel can't spoil the card for someone who hasn't played yet.
 */
export function DailyFriendsPanel(props: Props) {
  return (
    <Surface
      variant="framed"
      as="section"
      className="daily-panel"
      aria-labelledby="daily-friends-title"
    >
      <h2 id="daily-friends-title" className="daily-panel-title">
        Friends today
      </h2>
      {props.kind === 'guest' && (
        <>
          <p className="daily-panel-note">
            Sign in to see your friends' scores each day and keep your streak on every device.
            Results on this device come with you.
          </p>
          <Button to={signInPath('/daily')}>Sign in</Button>
        </>
      )}
      {props.kind === 'loading' && (
        <div role="status" aria-label="Loading" aria-busy="true" className="daily-friends-skeleton">
          <ul aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="daily-friends-skeleton-row" />
            ))}
          </ul>
        </div>
      )}
      {props.kind === 'error' && (
        <div className="daily-panel-error" role="alert">
          <span>{props.message}</span>
          <Button onClick={props.onRetry}>Retry</Button>
        </div>
      )}
      {props.kind === 'ready' &&
        (props.friends.length === 0 ? (
          <p className="daily-panel-note">
            Add friends to compare scores.{' '}
            <Button variant="link" to="/friends">
              Find friends
            </Button>
          </p>
        ) : (
          <ol className="daily-friends">
            {props.friends.map((f) => {
              const who = formatIdentity({ username: f.username, displayName: f.displayName });
              return (
                <li key={f.userId} className="daily-friend">
                  <UserAvatar imageUrl={f.avatarImageUrl} name={who.primary} size={28} />
                  <span className="daily-friend-name">{who.primary}</span>
                  <Score friend={f} />
                  <span className="daily-friend-streak">
                    {f.streak}
                    <span className="daily-friend-streak-label"> day streak</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ))}
    </Surface>
  );
}

import './WaitingOnYou.css';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  ChevronRight,
  ClipboardList,
  FolderPlus,
  Layers,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { findPriceTargetHits } from '../../lib/price-alerts';
import { formatIdentity } from '../../lib/display-name';
import { upcomingGameNights } from '../../lib/home-signals';
import { readHomeShape, rememberHomeShape } from '../../lib/home-shape';
import type { ActionRequiredItem } from '../../lib/activity-client';
import type { GameNight } from '../../lib/game-nights-api';
import { formatSlot } from '../NightPoll';
import { CalendarLeaf } from './CalendarLeaf';
import { useBinderReviewCount } from './use-binder-review-count';

const SHAPE_SLOT = 'waiting';

interface Task {
  key: string;
  to: string;
  title: string;
  detail: string;
  ariaLabel: string;
  icon?: LucideIcon;
  /** A game night's date, drawn as a calendar leaf instead of an icon. */
  leafAt?: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Props {
  actionRequired: ActionRequiredItem[];
  activityLoading: boolean;
  nights: GameNight[];
  nightsLoading: boolean;
}

/**
 * Everything on Home that needs an answer from you, in one row: trade offers,
 * friend requests, game nights you haven't replied to, cards waiting to be
 * filed in a binder, want-list cards under your target price, and the setup
 * steps a new account still has left. These used to be scattered through
 * five cards, most of which were empty most of the time.
 *
 * One line, never wrapping (§ Index-page insight strips): a grid-like row on
 * desktop, a swipe row with an edge fade below it. Nothing waiting renders
 * nothing — "all caught up" is not content. It appears once every source has
 * settled, and holds its line while loading if the last visit had one, so it
 * never pushes the decks down after first paint (E277).
 */
export function WaitingOnYou({ actionRequired, activityLoading, nights, nightsLoading }: Props) {
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const lists = useCollectionStore((s) => s.lists);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const deckCount = useDecksStore((s) => s.decks.length);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  const awaitingFirstPull = useAwaitingFirstPull();
  const review = useBinderReviewCount();
  const [remembered] = useState(() => readHomeShape()[SHAPE_SLOT]);

  const loading =
    activityLoading ||
    nightsLoading ||
    review === null ||
    hydrating ||
    !decksHydrated ||
    awaitingFirstPull;

  const tasks = useMemo(() => {
    const out: Task[] = [];

    const offers = actionRequired.filter((i) => i.type === 'trade_offer');
    if (offers.length === 1) {
      const o = offers[0];
      const from = formatIdentity({
        username: o.fromUsername,
        displayName: o.fromDisplayName,
      }).primary;
      out.push({
        key: 'offers',
        to: `/friends/${o.fromUserId}`,
        icon: ArrowLeftRight,
        title: 'Trade offer',
        detail: `From ${from}`,
        ariaLabel: `Trade offer from ${from}`,
      });
    } else if (offers.length > 1) {
      out.push({
        key: 'offers',
        to: '/trades',
        icon: ArrowLeftRight,
        title: plural(offers.length, 'trade offer'),
        detail: 'Waiting on your answer',
        ariaLabel: `${plural(offers.length, 'trade offer')} waiting on you`,
      });
    }

    const requests = actionRequired.filter((i) => i.type === 'friend_request');
    if (requests.length > 0) {
      const names = requests.map(
        (r) =>
          formatIdentity({ username: r.requesterUsername, displayName: r.requesterDisplayName })
            .primary
      );
      out.push({
        key: 'requests',
        to: '/friends?tab=requests',
        icon: UserPlus,
        title: plural(requests.length, 'friend request'),
        detail:
          names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : ''),
        ariaLabel: `${plural(requests.length, 'friend request')} waiting`,
      });
    }

    for (const night of upcomingGameNights(nights)) {
      if (night.isHost || night.myStatus !== null) continue;
      const polling = night.options.length > 0;
      out.push({
        key: `night:${night.id}`,
        to: '/play/nights',
        leafAt: night.startsAt,
        title: night.title,
        detail: polling ? 'Vote on a date' : `Reply · ${formatSlot(night.startsAt)}`,
        ariaLabel: polling
          ? `${night.title}: vote on a date`
          : `${night.title}, ${formatSlot(night.startsAt)}: reply`,
      });
    }

    if (review && review.count > 0) {
      out.push({
        key: 'binders',
        to: '/collection/binders',
        icon: ClipboardList,
        title: `${plural(review.count, 'card')} to file`,
        detail: `Across ${plural(review.binderCount, 'binder')}`,
        ariaLabel: `${plural(review.count, 'card')} to file across ${plural(review.binderCount, 'binder')}`,
      });
    }

    const hits = findPriceTargetHits(lists);
    if (hits.length === 1) {
      out.push({
        key: 'targets',
        to: '/collection/lists',
        icon: Target,
        title: `${hits[0].name} is under your target`,
        detail: hits[0].listName,
        ariaLabel: `${hits[0].name} is under your target price on ${hits[0].listName}`,
      });
    } else if (hits.length > 1) {
      out.push({
        key: 'targets',
        to: '/collection/lists',
        icon: Target,
        title: `${hits.length} cards under your target`,
        detail: hits
          .slice(0, 2)
          .map((h) => h.name)
          .join(', '),
        ariaLabel: `${hits.length} cards under your target price`,
      });
    }

    // Setup the hero's checklist no longer covers: it shows the steps only
    // while the collection is empty.
    if (cardCount > 0 && binderCount === 0) {
      out.push({
        key: 'first-binder',
        to: '/collection/binders',
        icon: FolderPlus,
        title: 'Build your first binder',
        detail: 'Rules sort your cards for you',
        ariaLabel: 'Build your first binder',
      });
    }
    if (cardCount > 0 && deckCount === 0) {
      out.push({
        key: 'first-deck',
        to: '/decks/new',
        icon: Layers,
        title: 'Make a deck',
        detail: 'From scratch, or start from a draft',
        ariaLabel: 'Make a deck',
      });
    }
    return out;
  }, [actionRequired, nights, review, lists, cardCount, binderCount, deckCount]);

  useEffect(() => {
    if (!loading) rememberHomeShape(SHAPE_SLOT, tasks.length > 0 ? 1 : 0);
  }, [loading, tasks.length]);

  if (loading) {
    if (!remembered) return null;
    return (
      <section className="home-waiting" aria-label="Waiting on you">
        <div className="home-waiting-head">
          <h2 className="home-waiting-title">Waiting on you</h2>
        </div>
        <div className="home-tasks" role="status" aria-label="Loading" aria-busy="true">
          <span className="home-task home-task--skeleton" />
          <span className="home-task home-task--skeleton" />
        </div>
      </section>
    );
  }
  if (tasks.length === 0) return null;

  return (
    <section className="home-waiting" aria-labelledby="home-waiting-title">
      <div className="home-waiting-head">
        <h2 id="home-waiting-title" className="home-waiting-title">
          Waiting on you
        </h2>
        <span className="home-waiting-count" aria-label={`${tasks.length} items`}>
          {tasks.length}
        </span>
      </div>
      <ul className="home-tasks">
        {tasks.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.key}>
              <Link to={t.to} className="home-task" aria-label={t.ariaLabel}>
                {t.leafAt !== undefined ? (
                  <CalendarLeaf at={t.leafAt} />
                ) : Icon ? (
                  <span className="home-task-icon" aria-hidden="true">
                    <Icon width={18} height={18} strokeWidth={1.8} />
                  </span>
                ) : null}
                <span className="home-task-text">
                  <span className="home-task-title">{t.title}</span>
                  <span className="home-task-detail">{t.detail}</span>
                </span>
                <ChevronRight
                  className="home-task-chevron"
                  width={16}
                  height={16}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

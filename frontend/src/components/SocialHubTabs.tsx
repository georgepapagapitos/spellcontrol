import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useActivity } from '../lib/use-activity';
import { listPods, pendingPodInviteCount, type Pod } from '../lib/pods-client';
import { HubTabsNav } from './HubTabsNav';

/**
 * Friends / Trades / Pods section-nav pills on the social pages — the same
 * hub treatment Collection and Decks get, replacing the ad-hoc shortcut links
 * FriendsPage used to own. Each page renders it directly under its PageHeader
 * (STYLE_GUIDE § Layout system), so the strip sits in the same place as you
 * move between the three destinations.
 *
 * Count chips carry the action-required numbers the old shortcut badges did:
 * trade offers waiting on the viewer, pod invites pending a reply. Trades
 * reads off the shared activity feed (the same bucket that drives Home's
 * badge, so the chip can never disagree with the notification that sent the
 * user here); pods is a best-effort fetch, badge off on failure — both
 * verbatim from the FriendsPage implementation this replaces.
 */
export function SocialHubTabs() {
  const { pathname } = useLocation();
  const username = useAuth((s) => s.user?.username ?? null);

  const { actionRequired } = useActivity();
  const pendingTrades = actionRequired.filter((i) => i.type === 'trade_offer').length;

  const [pods, setPods] = useState<Pod[] | null>(null);
  const pendingPodInvites = pods ? pendingPodInviteCount(pods) : 0;

  // Refetched on window focus, like the activity feed feeding the Trades
  // chip: an invite that lands while a social page sits open otherwise never
  // reaches this chip until a reload (playtest batch 9).
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const load = () => {
      listPods()
        .then((r) => {
          if (!cancelled) setPods(r);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [username]);

  return (
    <HubTabsNav
      ariaLabel="Social sections"
      tabs={[
        {
          to: '/friends',
          label: 'Friends',
          active: pathname.startsWith('/friends'),
        },
        {
          to: '/trades',
          label: 'Trades',
          active: pathname.startsWith('/trades'),
          count: pendingTrades,
          countNoun: 'offers waiting on you',
        },
        {
          to: '/pods',
          label: 'Pods',
          active: pathname.startsWith('/pods'),
          count: pendingPodInvites,
          countNoun: 'invites awaiting your reply',
        },
      ]}
    />
  );
}

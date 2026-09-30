import { useParams } from 'react-router-dom';
import { usePlayStore } from '@/store/play';
import { HubTabsNav } from '@/components/app-shell/HubTabsNav';

/**
 * Play / Local / Online / Game nights / History: Play's sections are routes
 * (`/play/:section`, E375), so it is a hub like Collection, Decks and Social
 * and wears the same strip. Rendered by HubPage, never by a page directly
 * (STYLE_GUIDE § Layout system → Hub pages).
 *
 * Local and Online carry a dot while a game is in progress there. The invite
 * count comes from the page, which already holds the game nights it lists, so
 * the chip moves the moment an invite is answered without a second fetch.
 */
export function PlayHubTabs({ counts }: { counts?: Record<string, number> }) {
  const { section } = useParams<{ section?: string }>();
  const current = section ?? 'home';
  const local = usePlayStore((s) => s.local);
  const online = usePlayStore((s) => s.online);
  const historyCount = usePlayStore((s) => s.history.length);

  return (
    <HubTabsNav
      ariaLabel="Play sections"
      tabs={[
        { to: '/play', label: 'Play', active: current === 'home' },
        {
          to: '/play/local',
          label: 'Local',
          active: current === 'local',
          live: local ? 'game in progress' : undefined,
        },
        {
          to: '/play/online',
          label: 'Online',
          active: current === 'online',
          live: online ? 'game in progress' : undefined,
        },
        {
          to: '/play/nights',
          label: 'Game nights',
          active: current === 'nights',
          count: counts?.['/play/nights'],
          countNoun: 'awaiting your reply',
        },
        {
          to: '/play/history',
          label: 'History',
          active: current === 'history',
          count: historyCount,
          countNoun: 'games',
        },
      ]}
    />
  );
}

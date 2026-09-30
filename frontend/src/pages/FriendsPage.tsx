import '@/components/social/FriendsManagement.css';
import { HubPage } from '@/components/app-shell/HubPage';
import { FriendsManagement } from '@/components/social/FriendsManagement';

/**
 * `/friends` — a real destination, not a settings section. The Trades / Pods
 * shortcuts (and their pending badges) that used to live in this page's
 * header are now the shared {@link SocialHubTabs} strip, which all three
 * social destinations render — same hub treatment as Collection and Decks.
 * The social mechanics (search, requests, inbox, activity) are all
 * `FriendsManagement`, which self-gates to a sign-in prompt for guests.
 */
export function FriendsPage() {
  return (
    <HubPage hub="social" section="Friends" titleId="friends-page-heading-title">
      <FriendsManagement />
    </HubPage>
  );
}

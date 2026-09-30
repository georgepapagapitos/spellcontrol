import '@/components/social/FriendsManagement.css';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { FriendsManagement } from '@/components/social/FriendsManagement';
import { SocialHubTabs } from '@/components/social/SocialHubTabs';

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
    <>
      <div className="friends-page social-page-shell">
        <PageHeader title="Social" titleId="friends-page-heading-title" />
        <SocialHubTabs />
        <FriendsManagement />
      </div>
    </>
  );
}

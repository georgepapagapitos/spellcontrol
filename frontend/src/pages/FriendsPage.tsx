import '../components/FriendsManagement.css';
import { PageHeader } from '@/components/PageHeader';
import { FriendsManagement } from '../components/FriendsManagement';
import { SocialHubTabs } from '../components/SocialHubTabs';

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
        <PageHeader title="Friends" titleId="friends-page-heading-title" />
        <SocialHubTabs />
        <FriendsManagement />
      </div>
    </>
  );
}

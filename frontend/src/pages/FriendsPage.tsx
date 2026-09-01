import '../components/FriendsManagement.css';
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
      <SocialHubTabs />
      <div className="friends-page">
        <div className="friends-page-header">
          <h1 id="friends-page-heading-title" className="friends-page-heading">
            Friends
          </h1>
        </div>
        <FriendsManagement />
      </div>
    </>
  );
}

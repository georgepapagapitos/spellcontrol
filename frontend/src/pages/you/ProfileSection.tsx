import { Link } from 'react-router-dom';
import { ProfileEditor } from '@/components/ProfileEditor';
import { ProfileFeaturedSettings } from '@/components/profile/ProfileFeaturedSettings';
import { UsernameEditor } from '@/components/UsernameEditor';
import { SettingsSection } from '@/components/settings/SettingsSection';

/** What other players see: display name, bio and avatar, then the username. */
export function ProfileSection({ username }: { username: string }) {
  return (
    <>
      <SettingsSection
        id="settings-profile-title"
        title="Public profile"
        hint={
          <Link className="text-link" to={`/u/${username}`}>
            View your public profile
          </Link>
        }
      >
        <ProfileEditor />
      </SettingsSection>
      <SettingsSection id="settings-featured-title" title="On your profile">
        <ProfileFeaturedSettings />
      </SettingsSection>
      <SettingsSection id="settings-username-title" title="Username">
        <UsernameEditor />
      </SettingsSection>
    </>
  );
}

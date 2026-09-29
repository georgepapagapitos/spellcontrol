import { track } from '@/lib/util/analytics';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { Button } from '@/components/shared/Button';

/**
 * Help, the legal pages and the fan-content notice. On a phone the site
 * footer is hidden, so this is the only door to Privacy and Terms there.
 */
export function HelpSection() {
  return (
    <>
      <SettingsSection id="settings-help-title" title="Help">
        <SettingsRow value="Rules reference" actions={<Button to="/rules">Open rules</Button>} />
        <SettingsRow
          value="Help & guides"
          actions={
            <Button href="/guides/" onClick={() => track('guide_cta')}>
              Open guides
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection id="settings-about-title" title="About">
        <SettingsRow
          value="Privacy policy"
          actions={<Button href="/privacy.html">Read policy</Button>}
        />
        <SettingsRow
          value="Terms of service"
          actions={<Button href="/terms.html">Read terms</Button>}
        />
        <div className="settings-page-about">
          <p>
            SpellControl is unofficial Fan Content permitted under the{' '}
            <a
              href="https://company.wizards.com/en/legal/fancontentpolicy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Fan Content Policy
            </a>
            . Not approved/endorsed by Wizards. Portions of the materials used are property of
            Wizards of the Coast. ©Wizards of the Coast LLC.
          </p>
        </div>
      </SettingsSection>
    </>
  );
}

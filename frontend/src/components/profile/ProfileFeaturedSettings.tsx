import { useEffect, useState } from 'react';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { updateProfile, type Profile } from '../../lib/auth-api';
import { fetchPublicProfile, type PublicProfileDeck } from '../../lib/profile-client';
import { userMessage } from '../../lib/user-error';
import { SelectMenu, type SelectOption } from '../SelectMenu';
import { Field, SwitchRow } from '../shared/form';

const NO_PIN = '';

/**
 * What the public profile leads with: the pinned deck (banner art and a
 * featured tile) and the opt-in game record. Each change saves on its own,
 * like every other switch on the You page, and reverts with a toast if the
 * save fails. The deck list is the owner's own public shelf, read the way a
 * visitor reads it, so a pin can only ever name a deck that is really there.
 */
export function ProfileFeaturedSettings() {
  const profile = useAuth((s) => s.profile);
  const username = useAuth((s) => s.user?.username ?? '');
  const [decks, setDecks] = useState<PublicProfileDeck[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetchPublicProfile(username)
      .then((p) => {
        if (!cancelled) setDecks(p.decks);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  async function save(patch: Partial<Pick<Profile, 'pinnedDeckSlug' | 'showGameRecord'>>) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateProfile(patch);
      useAuth.setState({ profile: updated });
    } catch (err) {
      toast.show({ message: userMessage(err, "Couldn't save that change."), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const options: SelectOption<string>[] = [
    { value: NO_PIN, label: 'None' },
    ...(decks ?? []).map((d) => ({ value: d.slug, label: d.name })),
  ];
  const pinned = profile?.pinnedDeckSlug ?? NO_PIN;
  const noDecks = decks !== null && decks.length === 0;

  return (
    <div className="profile-featured-settings">
      <Field
        label="Pinned deck"
        hint={
          failed
            ? "Couldn't load your public decks. Reload to try again."
            : noDecks
              ? 'Publish a deck and you can pin it here.'
              : 'Leads your profile with a larger tile and lends its art to your banner.'
        }
      >
        <SelectMenu<string>
          ariaLabel="Pinned deck"
          value={pinned}
          options={options}
          disabled={!profile || decks === null || noDecks || saving}
          onChange={(slug) => void save({ pinnedDeckSlug: slug === NO_PIN ? null : slug })}
        />
      </Field>
      <SwitchRow
        label="Show my game record on my profile"
        hint="Games, wins and win rate from your finished games with other players."
        checked={profile?.showGameRecord ?? false}
        disabled={!profile || saving}
        onChange={(next) => void save({ showGameRecord: next })}
      />
    </div>
  );
}

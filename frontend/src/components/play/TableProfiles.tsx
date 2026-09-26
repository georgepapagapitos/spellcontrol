import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import {
  MAX_PROFILE_NAME_LENGTH,
  usePlayStore,
  type LocalGameSetup,
  type TableProfile,
} from '../../store/play';
import { Button } from '@/components/shared/Button';

/**
 * Saved table setups, above the local-game form.
 *
 * A pod that plays the same four people every week shouldn't retype the roster
 * each session. Saving is explicit and loading replaces the whole form, so
 * "load my Thursday table" is always a clean slate rather than whatever last
 * week's game drifted into.
 *
 * Profiles are local to the device on purpose. They describe the table you sit
 * at, not the account you sign in with, and the roster is mostly other
 * people's names.
 */
export function TableProfiles({
  current,
  onLoad,
}: {
  /** The form's live values, captured when the player saves. */
  current: () => LocalGameSetup;
  onLoad: (setup: LocalGameSetup) => void;
}) {
  const profiles = usePlayStore((s) => s.tableProfiles);
  const saveTableProfile = usePlayStore((s) => s.saveTableProfile);
  const deleteTableProfile = usePlayStore((s) => s.deleteTableProfile);
  const [name, setName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const nameId = useId();

  const existing = profiles.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  const save = () => {
    if (!name.trim()) return;
    saveTableProfile(name, current());
    setName('');
  };

  return (
    <section className="table-profiles" aria-labelledby="table-profiles-label">
      <h3 id="table-profiles-label" className="play-setup-section-title">
        Table profiles
      </h3>

      {profiles.length === 0 ? (
        <p className="table-profiles-empty">
          No saved tables yet. Set the game up below, then save it here.
        </p>
      ) : (
        <ul className="table-profiles-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="table-profiles-row">
              <button
                type="button"
                className="table-profiles-load"
                onClick={() => {
                  onLoad(profile.setup);
                  setConfirmingId(null);
                }}
              >
                <span className="table-profiles-name">{profile.name}</span>
                <span className="table-profiles-meta">{describeProfile(profile)}</span>
              </button>
              {confirmingId === profile.id ? (
                <span className="table-profiles-confirm">
                  <button
                    type="button"
                    className="table-profiles-confirm-yes"
                    onClick={() => {
                      deleteTableProfile(profile.id);
                      setConfirmingId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="table-profiles-confirm-no"
                    onClick={() => setConfirmingId(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="table-profiles-delete"
                  aria-label={`Delete ${profile.name}`}
                  onClick={() => setConfirmingId(profile.id)}
                >
                  <Trash2 width={15} height={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="table-profiles-save">
        <label className="table-profiles-save-field" htmlFor={nameId}>
          <span className="play-setup-section-title">Save this setup as</span>
          <input
            id={nameId}
            className="table-profiles-save-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            // This section sits inside the setup <form>; an unhandled Enter
            // here submits that form and starts a game instead of saving (it
            // is not type="submit" for the same reason). Enter saves/updates
            // the profile instead, same as the button.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              save();
            }}
            maxLength={MAX_PROFILE_NAME_LENGTH}
            placeholder="Thursday pod"
          />
        </label>
        <Button disabled={!name.trim()} onClick={save} className="table-profiles-save-btn">
          {existing ? 'Update' : 'Save'}
        </Button>
      </div>
    </section>
  );
}

/** One line of recognisable detail, so an old profile is identifiable as old. */
function describeProfile(profile: TableProfile): string {
  const { players, startingLife, counters } = profile.setup;
  const names = players.map((p) => p.name.trim()).filter(Boolean);
  const roster = names.length > 0 ? names.join(', ') : `${players.length} players`;
  const extras = counters?.length ? ` · ${counters.join(', ')}` : '';
  return `${roster} · ${startingLife} life${extras}`;
}

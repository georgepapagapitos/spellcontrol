import { Camera } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../store/auth';
import { updateProfile, type AvatarPatch } from '../lib/auth-api';
import { isOnline, onSyncedChange } from '../lib/sync';
import { toast } from '../store/toasts';
import { UserAvatar } from './UserAvatar';
import { AvatarPickerSheet } from './AvatarPickerSheet';
import './ProfileEditor.css';

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 280;

function avatarsEqual(a: AvatarPatch | null, b: AvatarPatch | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.cardId === b.cardId && a.cardName === b.cardName && a.imageUrl === b.imageUrl;
}

/**
 * Display name, bio, and card-art avatar editor — dropped into Settings'
 * "Profile" section this wave, moving unchanged into the `/you` tab in W3.
 * Deliberately bare (no outer `.settings-card`/header of its own) so the
 * caller supplies whatever chrome fits its context; SettingsPage wraps it in
 * the same card shell every sibling section uses.
 *
 * The avatar picker stages its pick in local state — Save is the single
 * "when did this save" moment across all three fields, matching
 * `updateProfile`'s per-field PATCH semantics (always sending all three here,
 * since this editor always holds a value for each).
 */
export function ProfileEditor() {
  const profile = useAuth((s) => s.profile);
  const username = useAuth((s) => s.user?.username ?? '');

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<AvatarPatch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);

  const nameId = useId();
  const nameCountId = useId();
  const bioId = useId();
  const bioCountId = useId();

  // Seed local state from the loaded profile exactly once. A guard (rather
  // than re-seeding on every `profile` change) matters because Save's own
  // success path also updates the store's `profile` — re-seeding then would
  // clobber an edit typed in the gap between that update and this effect,
  // since "inputs stay editable" through a save-in-flight.
  useEffect(() => {
    if (!profile || seededRef.current) return;
    seededRef.current = true;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setAvatar(
      profile.avatarCardId && profile.avatarCardName && profile.avatarImageUrl
        ? {
            cardId: profile.avatarCardId,
            cardName: profile.avatarCardName,
            imageUrl: profile.avatarImageUrl,
          }
        : null
    );
  }, [profile]);

  // Reactive to connectivity changes so a reconnect while sitting on this
  // page flips the hint without needing another interaction (mirrors
  // SyncIndicator's own onSyncedChange subscription).
  const [, forceUpdate] = useState(0);
  useEffect(() => onSyncedChange(() => forceUpdate((n) => n + 1)), []);

  const loading = !profile;
  const disabled = loading;
  const savedAvatar: AvatarPatch | null =
    profile?.avatarCardId && profile.avatarCardName && profile.avatarImageUrl
      ? {
          cardId: profile.avatarCardId,
          cardName: profile.avatarCardName,
          imageUrl: profile.avatarImageUrl,
        }
      : null;
  const dirty =
    !!profile &&
    (displayName !== (profile.displayName ?? '') ||
      bio !== (profile.bio ?? '') ||
      !avatarsEqual(avatar, savedAvatar));

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateProfile({ displayName, bio, avatar });
      useAuth.setState({ profile: updated });
      // Reflect the canonical (trimmed/normalized) values the server stored.
      setDisplayName(updated.displayName ?? '');
      setBio(updated.bio ?? '');
      setAvatar(
        updated.avatarCardId && updated.avatarCardName && updated.avatarImageUrl
          ? {
              cardId: updated.avatarCardId,
              cardName: updated.avatarCardName,
              imageUrl: updated.avatarImageUrl,
            }
          : null
      );
      toast.show({ message: 'Profile saved.', tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't save your profile.",
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-editor">
      {loading && !isOnline() && (
        <p className="settings-card-hint">Reconnect to load your profile.</p>
      )}

      <div className="profile-editor-identity">
        <button
          type="button"
          className="profile-editor-avatar-trigger"
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          aria-label="Choose avatar"
        >
          <UserAvatar imageUrl={avatar?.imageUrl} name={displayName || username || '?'} size={96} />
          <span className="profile-editor-avatar-badge" aria-hidden="true">
            <Camera width={14} height={14} strokeWidth={2} />
          </span>
        </button>

        <div className="field profile-editor-name-field">
          <label htmlFor={nameId}>Display name</label>
          <input
            id={nameId}
            type="text"
            className="profile-editor-input"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX}
            disabled={disabled}
            aria-describedby={nameCountId}
            placeholder="Add a display name"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <span id={nameCountId} className="profile-editor-counter">
            {displayName.length}/{DISPLAY_NAME_MAX}
          </span>
        </div>
      </div>

      <div className="field profile-editor-field">
        <label htmlFor={bioId}>Bio</label>
        <textarea
          id={bioId}
          className="profile-editor-textarea"
          value={bio}
          maxLength={BIO_MAX}
          disabled={disabled}
          aria-describedby={bioCountId}
          placeholder="Add a short bio"
          rows={3}
          onChange={(e) => setBio(e.target.value)}
        />
        <span id={bioCountId} className="profile-editor-counter">
          {bio.length}/{BIO_MAX}
        </span>
      </div>

      <div className="profile-editor-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {pickerOpen && (
        <AvatarPickerSheet
          current={avatar}
          onPick={setAvatar}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

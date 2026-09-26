import { useId, useState } from 'react';
import { useAuth } from '../store/auth';
import { changeUsername, UsernameChangeError } from '../lib/auth-api';
import { toast } from '../store/toasts';
import { Modal } from './Modal';
import './UsernameEditor.css';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';

const USERNAME_MAX = 32;

/** Matches the server's own rule, so the disabled state and the 400 agree. */
const USERNAME_SHAPE = /^[a-z0-9_-]{3,32}$/;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The account's handle, and the flow for changing it.
 *
 * Deliberately its own section rather than another field inside
 * `ProfileEditor`: the display name saves silently alongside bio and avatar,
 * while this one breaks every link anybody has to the old handle, so it gets
 * a confirm step of its own and never rides along with an unrelated Save.
 *
 * The confirm dialog is where the consequences are stated, because that is
 * the moment the person is deciding. A refusal carries a date when there is
 * one — "not available" is a dead end, "available from 3 March" is a plan.
 */
export function UsernameEditor() {
  const username = useAuth((s) => s.user?.username ?? '');
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const fieldId = useId();
  const hintId = useId();

  const next = draft.trim().toLowerCase();
  const changed = next.length > 0 && next !== username;
  const valid = USERNAME_SHAPE.test(next);
  const canSubmit = changed && valid && !saving;

  async function handleConfirm() {
    setSaving(true);
    setDetail(null);
    try {
      const user = await changeUsername(next);
      useAuth.setState({ user });
      toast.show({ message: `You are now @${user.username}`, tone: 'success' });
      setConfirming(false);
      setDraft('');
    } catch (err) {
      if (err instanceof UsernameChangeError) {
        const when = err.availableAt ?? err.nextChangeAt;
        setDetail(when ? `${err.message} Try again from ${formatDate(when)}.` : err.message);
      } else {
        setDetail(userMessage(err, "Couldn't change your username. Try again."));
      }
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="username-editor">
      <p className="username-editor-current">
        <span className="username-editor-handle">@{username}</span>
        <span className="settings-row-hint">
          How friends find you, and the address of your public profile.
        </span>
      </p>

      <div className="field">
        <label htmlFor={fieldId}>New username</label>
        <input
          id={fieldId}
          type="text"
          className="username-editor-input"
          value={draft}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hintId}
          aria-invalid={changed && !valid}
          placeholder={username}
          onChange={(e) => {
            setDraft(e.target.value);
            setDetail(null);
          }}
        />
        <span id={hintId} className="settings-row-hint">
          {changed && !valid
            ? '3 to 32 characters, using lowercase letters, digits, _ and -.'
            : 'You can change this once every 30 days.'}
        </span>
      </div>

      {detail && (
        <p className="username-editor-detail" role="alert">
          {detail}
        </p>
      )}

      <div className="username-editor-actions">
        <Button variant="primary" disabled={!canSubmit} onClick={() => setConfirming(true)}>
          Change username
        </Button>
      </div>

      {confirming && (
        <Modal
          onClose={() => !saving && setConfirming(false)}
          labelledBy="username-change-title"
          dismissable={!saving}
        >
          <h2 id="username-change-title" className="choice-dialog-title">
            Change to @{next}?
          </h2>
          <p className="choice-dialog-body">
            Anyone who knows you as <strong>@{username}</strong> will see the new name. Links to
            your old profile keep working while nobody else takes the name, and you can change it
            again in 30 days.
          </p>
          <div className="choice-dialog-actions">
            <Button placement="row" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              placement="row"
              onClick={() => void handleConfirm()}
              disabled={saving}
            >
              {saving ? 'Changing…' : `Change to @${next}`}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

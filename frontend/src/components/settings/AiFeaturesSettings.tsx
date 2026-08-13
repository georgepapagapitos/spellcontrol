import { useEffect, useState } from 'react';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { fetchAiStatus, setAiOptIn, type AiStatus } from '../../lib/ai-review';
import { toast } from '../../store/toasts';

/**
 * The single global AI consent toggle (T96) — not a per-feature matrix.
 * Renders nothing when the backend doesn't have the feature configured or
 * the user is signed out; consent itself is enforced server-side, this is
 * just the switch.
 */
export function AiFeaturesSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* unavailable — render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const optIn = await setAiOptIn(!status.optIn);
      setStatus({ ...status, optIn });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Could not update the AI setting.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="group" aria-labelledby="settings-ai-group-title">
      <h2 id="settings-ai-group-title" className="settings-section-header">
        AI features
      </h2>
      <SettingsSection
        id="settings-ai-title"
        title="Read the deck"
        hint="Sends the deck you're viewing — card names and your deck's computed stats — to Anthropic to generate written analysis. Your collection is never sent."
      >
        <SettingsRow
          label="AI deck analysis"
          hint={
            status.optIn
              ? `Nothing is sent unless you press an AI button. ${status.limit} requests per day · used today: ${status.used}.`
              : 'Off. Nothing is ever sent while this is off.'
          }
          actions={
            <button type="button" className="btn" onClick={() => void toggle()} disabled={busy}>
              {busy ? 'Saving…' : status.optIn ? 'Turn off' : 'Turn on'}
            </button>
          }
        />
      </SettingsSection>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { SettingsSection } from './SettingsSection';
import { SwitchRow } from '../shared/form';
import { fetchAiStatus, setAiOptIn, type AiStatus } from '../../lib/ai-review';
import { toast } from '../../store/toasts';

import { userMessage } from '@/lib/user-error';
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
        message: userMessage(err, "Couldn't update the AI setting. Try again."),
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
        hint="Sends this deck to Anthropic for analysis: card names and your deck's stats. Your collection is never sent."
      >
        <SwitchRow
          label="AI deck analysis"
          hint={
            busy
              ? 'Saving…'
              : status.optIn
                ? `Nothing is sent unless you press an AI button. ${status.limit} requests per day · used today: ${status.used}.`
                : 'Off. Nothing is ever sent.'
          }
          checked={status.optIn}
          onChange={() => void toggle()}
          disabled={busy}
        />
      </SettingsSection>
    </div>
  );
}

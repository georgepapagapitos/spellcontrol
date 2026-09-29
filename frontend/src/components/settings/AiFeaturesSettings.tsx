import { useState } from 'react';
import { SettingsSection } from './SettingsSection';
import { SwitchRow } from '../shared/form';
import { setAiOptIn, type AiStatus } from '@/lib/ai/ai-review';
import { toast } from '../../store/toasts';

import { userMessage } from '@/lib/util/user-error';
/**
 * The single global AI consent toggle (T96) — not a per-feature matrix.
 * The You page fetches the status (its hub row shows On/Off, and hides when
 * the backend has no AI configured) and hands it down. Consent itself is
 * enforced server-side; this is just the switch.
 */
export function AiFeaturesSettings({
  status,
  onStatusChange,
}: {
  status: AiStatus;
  onStatusChange: (next: AiStatus) => void;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const optIn = await setAiOptIn(!status.optIn);
      onStatusChange({ ...status, optIn });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't update the AI setting. Try again."),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      id="settings-ai-title"
      title="Deck analysis"
      hint="When you press an AI button, that deck's card names and stats go to Anthropic. Your collection is never sent."
    >
      <SwitchRow
        label="AI deck analysis"
        hint={
          busy
            ? 'Saving…'
            : status.optIn
              ? `${status.limit} requests per day · used today: ${status.used}.`
              : 'Off.'
        }
        checked={status.optIn}
        onChange={() => void toggle()}
        disabled={busy}
      />
    </SettingsSection>
  );
}

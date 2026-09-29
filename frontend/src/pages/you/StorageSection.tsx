import { useState } from 'react';
import { logger } from '@/lib/util/logger';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore } from '@/store/decks';
import { toast } from '@/store/toasts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoTip } from '@/components/InfoTip';
import { OfflineModeSettings } from '@/components/OfflineModeSettings';
import { resetAppCacheAndReload } from '@/lib/account/reset-app-cache';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { Button } from '@/components/shared/Button';

/** What this device keeps (offline card data, the app cache), and the repair tools. */
export function StorageSection() {
  const cards = useCollectionStore((s) => s.cards);
  const deckCount = useDecksStore((s) => s.decks.length);
  const remapAllocations = useDecksStore((s) => s.remapAllocations);
  const [resetCacheOpen, setResetCacheOpen] = useState(false);
  const [resetCacheBusy, setResetCacheBusy] = useState(false);
  const canRepair = cards.length > 0 && deckCount > 0;

  function handleRepairAllocations() {
    if (!canRepair) return;
    remapAllocations(cards);
    toast.show({ message: 'Deck allocations repaired.', tone: 'success' });
  }

  async function handleResetAppCache() {
    setResetCacheOpen(false);
    setResetCacheBusy(true);
    try {
      await resetAppCacheAndReload();
      // resetAppCacheAndReload triggers location.reload(); nothing below runs.
    } catch (err) {
      logger.warn('[settings] reset app cache failed:', err);
      toast.show({
        message:
          "Couldn't reset the app cache. Try clearing this site's data in your browser settings.",
        tone: 'error',
      });
      setResetCacheBusy(false);
    }
  }

  return (
    <>
      <OfflineModeSettings />

      <SettingsSection id="settings-troubleshooting-title" title="Troubleshooting">
        <SettingsRow
          value="Reset app cache"
          hint="Reloads the app. Your data isn't touched."
          actions={
            <Button onClick={() => setResetCacheOpen(true)} disabled={resetCacheBusy}>
              {resetCacheBusy ? 'Resetting…' : 'Reset cache'}
            </Button>
          }
        />
        <SettingsRow
          value={
            <>
              Repair deck allocations
              <InfoTip
                label="deck allocations"
                text="Each deck slot reserves one of your physical copies. Repair redoes that match after edits or re-imports."
              />
            </>
          }
          valueWithTip
          hint={canRepair ? undefined : 'Needs cards and a deck.'}
          actions={
            <Button onClick={handleRepairAllocations} disabled={!canRepair}>
              Repair
            </Button>
          }
        />
      </SettingsSection>

      {resetCacheOpen && (
        <ConfirmDialog
          title="Reset app cache?"
          body="Reloads the app to fetch the latest version. Your data is kept."
          confirmLabel="Reset cache"
          onConfirm={() => void handleResetAppCache()}
          onCancel={() => setResetCacheOpen(false)}
        />
      )}
    </>
  );
}

import { useRef, useState } from 'react';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore } from '@/store/decks';
import { toast } from '@/store/toasts';
import { buildBackup, downloadBackup, parseBackup } from '@/lib/import-export/backup';
import { CollectionExportDialog } from '@/components/CollectionExportDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DeleteCollectionDialog } from '@/components/DeleteCollectionDialog';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { NEEDS_CARDS } from './sections';

/** Backup and restore, a card export for other tools, and deleting the collection. */
export function DataSection() {
  const cards = useCollectionStore((s) => s.cards);
  const cardCount = cards.length;
  const binders = useCollectionStore((s) => s.binders);
  const buildBackupSnapshot = useCollectionStore((s) => s.buildBackupSnapshot);
  const restoreFromBackup = useCollectionStore((s) => s.restoreFromBackup);
  const decks = useDecksStore((s) => s.decks);
  const hasAnything = cardCount > 0 || binders.length > 0 || decks.length > 0;

  const backupInputRef = useRef<HTMLInputElement>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);

  function handleDownloadBackup() {
    const snapshot = buildBackupSnapshot();
    downloadBackup(buildBackup(snapshot.collection, snapshot.binders, decks));
    toast.show({ message: 'Backup downloaded.', tone: 'success' });
  }

  /**
   * Replacing a non-empty collection/binders/decks is destructive with no
   * Undo, so ask first. Nothing to lose on a blank account, so no ask there.
   */
  function handlePickRestore() {
    if (hasAnything) {
      setRestoreConfirmOpen(true);
      return;
    }
    backupInputRef.current?.click();
  }

  async function applyBackupFile(file: File) {
    setRestoreBusy(true);
    try {
      const backup = parseBackup(await file.text());
      await restoreFromBackup(backup);
      const parts: string[] = [];
      if (backup.collection) {
        parts.push(`${backup.collection.cards.length.toLocaleString()} cards`);
      }
      parts.push(`${backup.binders.length} binder${backup.binders.length === 1 ? '' : 's'}`);
      if (backup.decks) {
        parts.push(`${backup.decks.length} deck${backup.decks.length === 1 ? '' : 's'}`);
      }
      toast.show({ message: `Backup restored · ${parts.join(' · ')}`, tone: 'success' });
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't restore that backup. Try again."),
        tone: 'error',
      });
    } finally {
      setRestoreBusy(false);
    }
  }

  async function handleBackupFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (backupInputRef.current) backupInputRef.current.value = '';
    if (file) await applyBackupFile(file);
  }

  return (
    <>
      {/* A disabled control's hint names what turns it on (STYLE_GUIDE
          § Voice rule 20). A backup carries binders and decks too, so it is
          live as soon as any of the three exists. */}
      <SettingsSection id="settings-collection-title" title="Backup">
        <SettingsRow
          value="Download backup"
          hint={
            hasAnything
              ? 'Your cards, binders and decks in one file.'
              : 'Needs cards, a binder or a deck.'
          }
          actions={
            <Button onClick={handleDownloadBackup} disabled={!hasAnything}>
              Download backup
            </Button>
          }
        />
        <SettingsRow
          value="Restore from a backup file"
          hint="Replaces everything here with the backup's contents."
          actions={
            <Button onClick={handlePickRestore} disabled={restoreBusy}>
              {restoreBusy ? 'Restoring…' : 'Restore…'}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection id="settings-export-title" title="Export">
        <SettingsRow
          value="Export cards"
          hint={cardCount > 0 ? 'A card list other tools can import.' : NEEDS_CARDS}
          actions={
            <Button
              aria-haspopup="dialog"
              onClick={() => setExportOpen(true)}
              disabled={cardCount === 0}
            >
              Export
            </Button>
          }
        />
      </SettingsSection>

      <Surface
        as="section"
        variant="framed"
        className="settings-card settings-card--danger"
        aria-labelledby="settings-danger-title"
      >
        <header className="settings-card-header">
          <h2 id="settings-danger-title" className="settings-card-title">
            Delete collection
          </h2>
          <p className="settings-card-hint">Download a backup first.</p>
        </header>
        <div className="settings-card-body">
          <SettingsRow
            value="Delete entire collection"
            hint={
              cardCount === 0
                ? NEEDS_CARDS
                : 'Removes every card and import-history entry. Binders stay, but empty.'
            }
            actions={
              <Button variant="danger" onClick={() => setWipeOpen(true)} disabled={cardCount === 0}>
                Delete collection
              </Button>
            }
          />
        </div>
      </Surface>

      {exportOpen && <CollectionExportDialog cards={cards} onClose={() => setExportOpen(false)} />}

      <input
        type="file"
        ref={backupInputRef}
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => void handleBackupFileChange(e)}
        disabled={restoreBusy}
      />

      {restoreConfirmOpen && (
        <ConfirmDialog
          title="Restore backup?"
          body="This replaces your current collection, binders, and decks with the backup's contents. This can't be undone."
          confirmLabel="Restore"
          danger
          onConfirm={() => {
            setRestoreConfirmOpen(false);
            backupInputRef.current?.click();
          }}
          onCancel={() => setRestoreConfirmOpen(false)}
        />
      )}

      {wipeOpen && <DeleteCollectionDialog onClose={() => setWipeOpen(false)} />}
    </>
  );
}

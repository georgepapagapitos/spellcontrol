import './ExportDialog.css';
import { useMemo } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { canShare, openShareSheet } from '@/lib/util/web-share';
import { Modal } from '@/components/overlays/Modal';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import type { ExportFormat } from '@/lib/import-export/deck-export';
import { Button, IconButton } from '@/components/shared/Button';
import { CopyButton } from '@/components/shared/CopyButton';

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  mtga: 'MTGA',
  plain: 'Plaintext',
  moxfield: 'Moxfield',
  mtgo: 'MTGO',
};

interface Props {
  text: string;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  /** Deck title — names the downloaded .txt file (sanitized; falls back to
   *  "deck"). Mirrors BuyListDialog's own `title` prop; the dialog heading
   *  itself stays the generic "Export deck" so a static trigger label (the
   *  decks-index overflow item, the shared-view button) always matches what
   *  opens. */
  title: string;
  onClose: () => void;
}

/**
 * Decklist export dialog: format picker (MTGA/Plaintext/Moxfield/MTGO), a
 * read-only preview, and copy-to-clipboard / download (.txt, or .dek for
 * MTGO) actions, plus the system share sheet (`Share…`) where available
 * platforms, and a "Print list" checklist action on web (hidden on native,
 * where `window.print()` has no equivalent).
 * Shared by the deck editor, its decks-index deep link, and the public
 * shared deck view — all three just supply `text` (from `buildExport`) and
 * `title` (the deck's name); copy/download/share/print are handled
 * internally so no caller re-implements that logic.
 */
export function DeckExportDialog({ text, format, onFormatChange, title, onClose }: Props) {
  const lineCount = useMemo(() => text.split('\n').filter(Boolean).length, [text]);

  const handleDownload = () => {
    const blob = new Blob([text], { type: format === 'mtgo' ? 'application/xml' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
    a.download = `${safeName}.${format === 'mtgo' ? 'dek' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // Print the deck list behind this dialog as a checklist — close first so
  // the modal overlay itself doesn't print; @media print hides everything
  // but the list (see deck-builder-display.css).
  const handlePrint = () => {
    onClose();
    requestAnimationFrame(() => window.print());
  };
  // System share sheet — parity with ShareDialog's handleShare.
  // No `url` field: this hands off the raw decklist text, not a link.
  const handleShare = async () => {
    await openShareSheet({ title: `${title} · decklist`, text });
  };

  return (
    <Modal onClose={onClose} className="modal export-dialog" labelledBy="export-deck-title">
      <div className="export-dialog-header">
        <h2 id="export-deck-title" className="export-dialog-title">
          Export deck
        </h2>
        <IconButton
          variant="quiet"
          onClick={onClose}
          label="Close"
          icon={<X width={18} height={18} strokeWidth={2} />}
        />
      </div>
      <div className="export-dialog-body">
        <div className="export-dialog-controls">
          <SelectMenu
            label="Format"
            ariaLabel="Export format"
            value={format}
            onChange={(v) => onFormatChange(v as ExportFormat)}
            options={(Object.keys(EXPORT_FORMAT_LABEL) as ExportFormat[]).map((f) => ({
              value: f,
              label: EXPORT_FORMAT_LABEL[f],
              itemLabel:
                f === 'mtgo' ? `${EXPORT_FORMAT_LABEL[f]} (.dek file for Magic Online)` : undefined,
            }))}
          />
          <span className="export-dialog-meta">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <div className="export-dialog-actions">
            <Button
              onClick={handleDownload}
              aria-label="Download as text file"
              icon={<Download width={14} height={14} strokeWidth={1.8} />}
            >
              Download
            </Button>
            <CopyButton
              value={text}
              what="the decklist"
              icon
              variant="primary"
              aria-label="Copy to clipboard"
            />
            {canShare() && <Button onClick={handleShare}>Share…</Button>}
            {!canShare() && (
              <Button
                onClick={handlePrint}
                aria-label="Print this decklist as a checklist"
                icon={<Printer width={14} height={14} strokeWidth={1.8} />}
              >
                Print list
              </Button>
            )}
          </div>
        </div>
        <textarea
          className="export-dialog-preview"
          aria-label="Exported decklist"
          value={text}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { Check, Clipboard, Download, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SelectMenu } from '../SelectMenu';
import type { ExportFormat } from '@/lib/deck-export';

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  mtga: 'MTGA',
  plain: 'Plaintext',
  moxfield: 'Moxfield',
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
 * Decklist export dialog: format picker (MTGA/Plaintext/Moxfield), a
 * read-only preview, and copy-to-clipboard / download-as-.txt actions.
 * Shared by the deck editor, its decks-index deep link, and the public
 * shared deck view — all three just supply `text` (from `buildExport`) and
 * `title` (the deck's name); copy/download are handled internally so no
 * caller re-implements clipboard/blob logic.
 */
export function DeckExportDialog({ text, format, onFormatChange, title, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => text.split('\n').filter(Boolean).length, [text]);

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
    a.download = `${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal onClose={onClose} className="modal export-dialog" labelledBy="export-deck-title">
      <div className="export-dialog-header">
        <h2 id="export-deck-title" className="export-dialog-title">
          Export deck
        </h2>
        <button type="button" className="export-dialog-close" aria-label="Close" onClick={onClose}>
          <X width={18} height={18} strokeWidth={2} aria-hidden />
        </button>
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
            }))}
          />
          <span className="export-dialog-meta">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <div className="export-dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={handleDownload}
              aria-label="Download as text file"
            >
              <Download width={14} height={14} strokeWidth={2} aria-hidden />
              <span>Download</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopyClick}
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check width={14} height={14} strokeWidth={2.5} aria-hidden />
              ) : (
                <Clipboard width={14} height={14} strokeWidth={2} aria-hidden />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
        <textarea
          className="export-dialog-preview"
          value={text}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { canShare, openShareSheet } from '@/lib/util/web-share';
import { Modal } from './Modal';
import { SelectMenu } from './SelectMenu';
import { toast } from '../store/toasts';
import { useCurrencyStore } from '@/lib/collection/currency';
import type { EnrichedCard } from '../types';
import {
  COLLECTION_EXPORT_FORMATS,
  collectionExportFileName,
  collectionToExport,
  downloadText,
  readStoredCollectionExportFormat,
  writeStoredCollectionExportFormat,
  type CollectionExportFormat,
} from '@/lib/import-export/collection-export';
import { Button, IconButton } from '@/components/shared/Button';
import { CopyButton } from '@/components/shared/CopyButton';

const PREVIEW_LINES = 30;

interface Props {
  cards: EnrichedCard[];
  /** Set when exporting one binder: names the file and the heading. */
  binderName?: string;
  onClose: () => void;
}

/**
 * Collection / binder export: format picker (SpellControl, Moxfield,
 * Archidekt, Arena), a preview of the first rows, and download / copy /
 * native share. Same chrome as DeckExportDialog (`.export-dialog`), so the
 * two exports read as one surface. The full text is built once per format;
 * only the head of it is shown, since a real collection is 10k+ rows.
 */
export function CollectionExportDialog({ cards, binderName, onClose }: Props) {
  const currency = useCurrencyStore((s) => s.currency);
  const [format, setFormat] = useState<CollectionExportFormat>(() =>
    readStoredCollectionExportFormat()
  );

  const text = useMemo(
    () => collectionToExport(cards, format, currency),
    [cards, format, currency]
  );
  const rowCount = useMemo(
    () => text.split('\n').length - (format === 'mtga' ? 0 : 1),
    [text, format]
  );
  const preview = useMemo(() => {
    const lines = text.split('\n', PREVIEW_LINES + 1);
    return lines.length > PREVIEW_LINES
      ? `${lines.slice(0, PREVIEW_LINES).join('\n')}\n…`
      : lines.join('\n');
  }, [text]);

  const option = COLLECTION_EXPORT_FORMATS.find((f) => f.value === format)!;
  const fileName = collectionExportFileName(format, binderName);
  const cardCount = cards.length.toLocaleString();
  const rowWord = format === 'mtga' ? 'line' : 'row';

  const handleFormatChange = (f: CollectionExportFormat) => {
    setFormat(f);
    writeStoredCollectionExportFormat(f);
  };
  const handleDownload = () => {
    downloadText(text, fileName);
    toast.show({
      message: `${option.label} downloaded: ${cardCount} cards, ${rowCount.toLocaleString()} ${rowWord}s.`,
      tone: 'success',
    });
    onClose();
  };
  const handleShare = async () => {
    await openShareSheet({ title: fileName, text });
  };

  return (
    <Modal onClose={onClose} className="modal export-dialog" labelledBy="export-collection-title">
      <div className="export-dialog-header">
        <h2 id="export-collection-title" className="export-dialog-title">
          {binderName ? `Export binder: ${binderName}` : 'Export collection'}
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
            onChange={(v) => handleFormatChange(v as CollectionExportFormat)}
            options={COLLECTION_EXPORT_FORMATS.map((f) => ({
              value: f.value,
              label: f.label,
              itemLabel: `${f.label} · ${f.description}`,
            }))}
          />
          <span className="export-dialog-meta">
            {cardCount} cards · {rowCount.toLocaleString()} {rowWord}
            {rowCount === 1 ? '' : 's'}
          </span>
          <div className="export-dialog-actions">
            <Button
              variant="primary"
              onClick={handleDownload}
              aria-label={`Download ${fileName}`}
              icon={<Download width={14} height={14} strokeWidth={1.8} />}
            >
              Download
            </Button>
            <CopyButton value={text} what="the export" icon aria-label="Copy to clipboard" />
            {canShare() && <Button onClick={handleShare}>Share…</Button>}
          </div>
        </div>
        <p className="export-dialog-hint">
          Saves as <code>{fileName}</code>.
        </p>
        <textarea
          className="export-dialog-preview"
          aria-label={`Preview, first ${PREVIEW_LINES} ${rowWord}s`}
          value={preview}
          readOnly
          wrap="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Modal>
  );
}

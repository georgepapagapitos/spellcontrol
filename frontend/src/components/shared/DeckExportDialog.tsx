import './ExportDialog.css';
import { useMemo, useState } from 'react';
import { Download, FileDown, Printer, X } from 'lucide-react';
import { canShare, openShareSheet } from '@/lib/util/web-share';
import { Modal } from '@/components/overlays/Modal';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import type { ExportFormat } from '@/lib/import-export/deck-export';
import { fetchMpcOrder, type MpcOrder } from '@/lib/import-export/mpc-order';
import { Button, IconButton } from '@/components/shared/Button';
import { CopyButton } from '@/components/shared/CopyButton';

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  mtga: 'MTGA',
  plain: 'Plaintext',
  moxfield: 'Moxfield',
  mtgo: 'MTGO',
  mpc: 'MPC Autofill',
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

  const safeName = title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck';
  const handleDownload = () => {
    saveFile(
      text,
      format === 'mtgo' ? 'application/xml' : 'text/plain',
      `${safeName}.${format === 'mtgo' ? 'dek' : 'txt'}`
    );
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
                f === 'mtgo'
                  ? `${EXPORT_FORMAT_LABEL[f]} (.dek file for Magic Online)`
                  : f === 'mpc'
                    ? `${EXPORT_FORMAT_LABEL[f]} (list and order file for printing proxies)`
                    : undefined,
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
        {format === 'mpc' && <MpcOrderSection list={text} fileName={`${safeName}.xml`} />}
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

function saveFile(body: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type OrderState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; order: MpcOrder }
  | { kind: 'error'; message: string };

/**
 * The MPC Autofill order file: the list above with an image already picked
 * for every card, so the desktop tool can upload the order as is. A list
 * that changes (the format flips back and forth) starts over.
 */
function MpcOrderSection({ list, fileName }: { list: string; fileName: string }) {
  const [state, setState] = useState<OrderState>({ kind: 'idle' });
  const [forList, setForList] = useState(list);
  if (forList !== list) {
    setForList(list);
    setState({ kind: 'idle' });
  }
  const busy = state.kind === 'busy';

  const handleOrder = async () => {
    setState({ kind: 'busy' });
    try {
      const order = await fetchMpcOrder(list);
      if (order.slots > 0) saveFile(order.xml, 'application/xml', fileName);
      setState({ kind: 'done', order });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="export-dialog-mpc" aria-labelledby="export-mpc-title">
      <div className="export-dialog-mpc-text">
        <h3 id="export-mpc-title" className="export-dialog-mpc-title">
          Order file
        </h3>
        <p className="export-dialog-hint">
          Picks the top-ranked MPC Autofill image for every card. Run the file with the MPC Autofill
          desktop tool to fill a MakePlayingCards order, or import it at{' '}
          <a href="https://mpcfill.com/editor" target="_blank" rel="noopener noreferrer">
            mpcfill.com
          </a>{' '}
          to change any art first.
        </p>
        <p className="export-dialog-mpc-status" role="status">
          {state.kind === 'done' && <OrderSummary order={state.order} fileName={fileName} />}
        </p>
        {state.kind === 'error' && (
          <p className="export-dialog-mpc-error" role="alert">
            {state.message}
          </p>
        )}
      </div>
      <Button
        onClick={handleOrder}
        disabled={busy}
        aria-busy={busy}
        icon={<FileDown width={14} height={14} strokeWidth={1.8} />}
      >
        {busy ? 'Matching images…' : 'Download order file'}
      </Button>
    </section>
  );
}

function OrderSummary({ order, fileName }: { order: MpcOrder; fileName: string }) {
  const { slots, missing } = order;
  const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;
  if (slots === 0) return <>MPC Autofill has no image for any card on this list.</>;
  return (
    <>
      Saved {fileName} with {cards(slots)}.
      {missing.length > 0 && (
        <>
          {' '}
          No image for {missing.length === 1 ? 'this one, so it' : 'these, so they'} stayed out:{' '}
          {missing.join(', ')}.
        </>
      )}
    </>
  );
}

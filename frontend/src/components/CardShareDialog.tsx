import { useState, type ReactNode } from 'react';
import { Clipboard, Download, Link as LinkIcon, Loader2, Mail } from 'lucide-react';
import { Modal } from './Modal';
import { toast } from '../store/toasts';
import './CardShareDialog.css';

interface Props {
  /** Card name — titles the dialog and names the downloaded file. */
  name: string;
  /** Art for the face currently on screen (front or back). */
  imageUrl: string;
  onClose: () => void;
}

/**
 * Desktop-web fallback for the card preview's Share action.
 *
 * Where the OS can share files (native, and mobile browsers with the Web Share
 * API) we hand the image straight to the system sheet — that's the one with the
 * user's recent conversations in it, and nothing we build competes. Desktop
 * browsers have no such sheet, so this dialog offers the same destinations by
 * hand: clipboard, disk, mail, link.
 */
export function CardShareDialog({ name, imageUrl, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const filename = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`;

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast.show({ message: done, tone: 'success' });
      onClose();
    } catch {
      toast.show({ message: "Couldn't do that — the card art didn't load.", tone: 'warn' });
      setBusy(null);
    }
  };

  const fetchArt = async () => (await fetch(imageUrl)).blob();

  // Clipboard images must be PNG — re-encode the jpeg through a canvas. The
  // ClipboardItem takes the *promise*: Safari rejects a write whose data was
  // awaited outside the user gesture.
  const copyImage = () =>
    navigator.clipboard.write([
      new ClipboardItem({
        'image/png': (async () => {
          const bitmap = await createImageBitmap(await fetchArt());
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          return new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png')
          );
        })(),
      }),
    ]);

  const saveImage = async () => {
    const href = URL.createObjectURL(await fetchArt());
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    // Firefox needs the blob URL to outlive the click.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const options: Array<{
    key: string;
    icon: ReactNode;
    title: string;
    desc: string;
    run: () => Promise<void>;
    done: string;
  }> = [
    // mailto can't carry an attachment, so mail gets the art as a link.
    {
      key: 'save',
      icon: <Download width={18} height={18} strokeWidth={2} aria-hidden />,
      title: 'Save image',
      desc: `Downloads ${filename}`,
      run: saveImage,
      done: 'Card image saved.',
    },
    {
      key: 'email',
      icon: <Mail width={18} height={18} strokeWidth={2} aria-hidden />,
      title: 'Email',
      desc: 'Opens a new message with a link to the art',
      run: async () => {
        // assign(), not `location.href =` — the React Compiler lint hard-errors
        // on assigning to a value defined outside the component.
        window.location.assign(
          `mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(`${name}\n${imageUrl}`)}`
        );
      },
      done: 'Opening your mail app…',
    },
    {
      key: 'link',
      icon: <LinkIcon width={18} height={18} strokeWidth={2} aria-hidden />,
      title: 'Copy image link',
      desc: 'A direct link most chat apps show inline',
      run: () => navigator.clipboard.writeText(imageUrl),
      done: 'Image link copied.',
    },
  ];

  // Firefox only gained image writes in 127 — offer it where it works.
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    options.unshift({
      key: 'copy',
      icon: <Clipboard width={18} height={18} strokeWidth={2} aria-hidden />,
      title: 'Copy image',
      desc: 'Paste it straight into a chat or doc',
      run: copyImage,
      done: 'Card image copied.',
    });
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="card-share-title"
      dismissable={!busy}
      // The card preview portals us to <body> as a *sibling* of its own
      // backdrop, which sits at --z-overlay — a plain --z-modal backdrop
      // paints underneath it, leaving the dialog visible but unclickable.
      backdropClassName="modal-backdrop--over-sheet"
    >
      <h2 id="card-share-title" className="choice-dialog-title">
        Share {name}
      </h2>
      <div className="choice-dialog-options">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="choice-dialog-option card-share-option"
            onClick={() => void run(o.key, o.run, o.done)}
            disabled={!!busy}
            aria-busy={busy === o.key}
          >
            <span className="card-share-option-icon">
              {busy === o.key ? <Loader2 className="card-share-spinner" aria-hidden /> : o.icon}
            </span>
            <span className="card-share-option-text">
              <span className="choice-dialog-option-title">{o.title}</span>
              <span className="choice-dialog-option-desc">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

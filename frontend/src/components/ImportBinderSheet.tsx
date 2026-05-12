import { useEffect, useRef, useState } from 'react';
import { importFile, importText } from '../lib/api';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';

interface Props {
  onClose: () => void;
}

export function ImportBinderSheet({ onClose }: Props) {
  const importCards = useCollectionStore((s) => s.importCards);
  const isLoading = useCollectionStore((s) => s.isLoading);
  const setLoading = useCollectionStore((s) => s.setLoading);

  const [binderName, setBinderName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useLockBodyScroll();

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, isLoading]);

  const canImport = binderName.trim().length > 0 && pasteText.trim().length > 0 && !isLoading;

  async function runImport(fn: () => ReturnType<typeof importText>, label: string) {
    const name = binderName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await fn();
      await importCards(result, label, 'binder', { binderName: name });
      setSuccessMsg(`Imported ${result.cards.length.toLocaleString()} cards into "${name}"`);
      setPasteText('');
      setBinderName('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Import failed. Check the format and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text || !binderName.trim()) return;
    runImport(() => importText(text), 'pasted-list');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !binderName.trim()) return;
    runImport(() => importFile(file), file.name);
  };

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (!isLoading) onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet import-binder-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Import binder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Import binder</h2>
          <p className="import-binder-hint">
            Paste or upload a card list to create a new binder. Cards will be added to your
            collection and placed in the binder in the order listed.
          </p>
        </div>

        <div className="import-binder-body">
          {successMsg && (
            <div className="success-banner" style={{ margin: '0 0 0.75rem' }}>
              <span>{successMsg}</span>
              <button
                type="button"
                className="banner-dismiss"
                onClick={() => setSuccessMsg(null)}
                aria-label="Dismiss"
              >
                x
              </button>
            </div>
          )}

          {error && (
            <div className="error-banner" style={{ margin: '0 0 0.75rem' }}>
              <span>{error}</span>
              <button
                type="button"
                className="banner-dismiss"
                onClick={() => setError(null)}
                aria-label="Dismiss"
              >
                x
              </button>
            </div>
          )}

          <label className="import-binder-label">
            Binder name
            <input
              ref={nameInputRef}
              type="text"
              className="binder-name-input import-binder-name"
              placeholder="e.g. Trade binder, Commander staples"
              value={binderName}
              onChange={(e) => setBinderName(e.target.value)}
              maxLength={60}
              disabled={isLoading}
            />
          </label>

          <label className="import-binder-label">
            Card list
            <textarea
              className="paste-textarea import-binder-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'1 Llanowar Elves\n1 Birds of Paradise\n4 Lightning Bolt\n...'}
              disabled={isLoading}
            />
          </label>
        </div>

        <div className="card-picker-footer import-binder-footer">
          <button
            type="button"
            className="btn import-upload-btn"
            onClick={() => {
              if (!binderName.trim()) {
                nameInputRef.current?.focus();
                return;
              }
              fileInputRef.current?.click();
            }}
            disabled={isLoading}
          >
            Upload CSV
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv,.tsv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={isLoading}
          />
          <div className="import-binder-footer-right">
            <button type="button" className="btn" onClick={onClose} disabled={isLoading}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePasteImport}
              disabled={!canImport}
            >
              {isLoading ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

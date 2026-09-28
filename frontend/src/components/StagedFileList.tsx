import { X } from 'lucide-react';
import { MAX_STAGED_FILES } from '../lib/staged-files';
import { Button, IconButton } from '@/components/shared/Button';

interface Props {
  files: File[];
  onRemove: (index: number) => void;
  onClear: () => void;
  disabled?: boolean;
  max?: number;
}

/**
 * Read-only staged-file list with per-file remove and a clear-all control.
 * Shared by the deck, collection, and binder import surfaces so they all get
 * the same append / remove / cap affordances.
 */
export function StagedFileList({
  files,
  onRemove,
  onClear,
  disabled = false,
  max = MAX_STAGED_FILES,
}: Props) {
  if (files.length === 0) return null;
  return (
    <div className="staged-files">
      <div className="staged-files-head">
        <strong>
          {files.length} of {max} file{max === 1 ? '' : 's'} staged
        </strong>
        <Button variant="link" onClick={onClear} disabled={disabled}>
          Clear
        </Button>
      </div>
      <ul className="staged-files-list">
        {files.map((f, i) => (
          <li key={f.name}>
            <span className="staged-files-name">{f.name}</span>
            <IconButton
              className="staged-files-remove"
              onClick={() => onRemove(i)}
              disabled={disabled}
              label={`Remove ${f.name}`}
              title="Remove"
              icon={<X width={14} height={14} strokeWidth={1.8} />}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

import './BinderVolumesSheet.css';
import { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';
import { Button, IconButton } from '@/components/shared/Button';
import { smallestFittingCapacity } from '../lib/binder-volumes';
import type { PocketSize, Volume } from '../types';

interface Props {
  binderName: string;
  volumes: Volume[];
  fixedCapacity: number;
  pocketSize: PocketSize;
  /** From the same unfiltered materialize pass `volumes` came from. */
  totalPages: number;
  onApplyFit: (size: number) => void;
  onOpenRules: () => void;
  onClose: () => void;
}

function pageRange(v: Volume): string {
  return v.pageStart === v.pageEnd ? `p. ${v.pageStart}` : `pp. ${v.pageStart}–${v.pageEnd}`;
}

function spine(v: Volume): string {
  return v.firstLabel === v.lastLabel ? v.firstLabel : `${v.firstLabel} → ${v.lastLabel}`;
}

/**
 * Opened from the binder hero's "N volumes" button once a binder outgrows
 * its own fixed capacity (E494). A normal state, not a warning — the user's
 * own plan is to shelve it as several physical books, so this sheet just
 * answers "how many, and where does each start and end", the way the page
 * viewer answers "which page". Never inline in the page flow: a sheet, per
 * the standing rule that an insight surface never displaces content
 * (`feedback_insight_surfaces_never_displace_content`) — a bottom sheet on
 * phones, a centered dialog above (`Modal` + `modal-backdrop--sheet`, same
 * as `DeckFormatSheet`).
 */
export function BinderVolumesSheet({
  binderName,
  volumes,
  fixedCapacity,
  pocketSize,
  totalPages,
  onApplyFit,
  onOpenRules,
  onClose,
}: Props) {
  const titleId = useId();
  // Page-based: a size only "fits" once its own page depth covers every page
  // this binder actually has. Comparing against raw card counts under-counts
  // whenever sections start fresh pages — see smallestFittingCapacity's doc.
  const fitSize = smallestFittingCapacity(totalPages, pocketSize);

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      className="modal binder-volumes-sheet"
      backdropClassName="modal-backdrop--sheet"
    >
      <div className="modal-header">
        <h2 id={titleId}>Volumes</h2>
        <IconButton
          variant="quiet"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>
      <div className="modal-body binder-volumes-sheet-body">
        <p className="binder-volumes-sheet-intro">
          {binderName} fills {volumes.length} binders of {fixedCapacity.toLocaleString()} cards.
        </p>
        <ul className="binder-volumes-list">
          {volumes.map((v) => (
            <li key={v.index} className="binder-volumes-row">
              <span className="binder-volumes-row-index">Vol {v.index}</span>
              <span className="binder-volumes-row-pages">{pageRange(v)}</span>
              <span className="binder-volumes-row-spine">{spine(v)}</span>
              <span className="binder-volumes-row-count">
                {v.cardCount.toLocaleString()} {v.cardCount === 1 ? 'card' : 'cards'}
              </span>
            </li>
          ))}
        </ul>
        <div className="binder-volumes-sheet-fix">
          {fitSize ? (
            <Button variant="primary" onClick={() => onApplyFit(fitSize)}>
              Use a {fitSize.toLocaleString()}-card binder
            </Button>
          ) : (
            <p className="binder-volumes-sheet-hint">
              No standard size holds it in one book, so it stays in {volumes.length} volumes.
            </p>
          )}
          <Button variant="link" onClick={onOpenRules}>
            Binder rules
          </Button>
        </div>
      </div>
    </Modal>
  );
}

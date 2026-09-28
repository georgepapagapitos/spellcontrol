import { Disclosure } from './shared/form';
import { Button } from '@/components/shared/Button';
import { smallestFittingCapacity } from '../lib/binder-volumes';
import type { PocketSize, Volume } from '../types';

interface Props {
  volumes: Volume[];
  fixedCapacity: number;
  pocketSize: PocketSize;
  totalCards: number;
  onOpenRules: () => void;
}

function pageRange(v: Volume): string {
  return v.pageStart === v.pageEnd ? `p. ${v.pageStart}` : `pp. ${v.pageStart}–${v.pageEnd}`;
}

function spine(v: Volume): string {
  return v.firstLabel === v.lastLabel ? v.firstLabel : `${v.firstLabel} → ${v.lastLabel}`;
}

/**
 * Under a binder's page header once it outgrows its own fixed capacity
 * (`lib/binder-volumes.ts`): a one-line summary that expands into the shelf
 * of physical books this rule set actually needs, plus a hint toward the
 * smallest standard size that would hold everything in one book instead. A
 * "Split into volumes" acknowledgement and a real "Use a binder that fits"
 * fix action are the editor's job (board E494, lane L6) — this is the
 * read-only answer to "how many binders do I need, and where does each one
 * start and end".
 */
export function BinderVolumesBar({
  volumes,
  fixedCapacity,
  pocketSize,
  totalCards,
  onOpenRules,
}: Props) {
  const fitSize = smallestFittingCapacity(totalCards, pocketSize);
  return (
    <div className="binder-volumes-bar" role="status">
      <Disclosure
        title="Volumes"
        summary={`Fills ${volumes.length} binders of ${fixedCapacity.toLocaleString()}`}
      >
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
        <p className="binder-volumes-fit-hint">
          {fitSize ? (
            <>
              A single {fitSize.toLocaleString()}-card binder would hold everything instead of{' '}
              {volumes.length}.{' '}
            </>
          ) : (
            'No standard binder size holds everything in one book. Splitting is the only fit. '
          )}
          <Button variant="link" onClick={onOpenRules}>
            Binder rules
          </Button>
        </p>
      </Disclosure>
    </div>
  );
}

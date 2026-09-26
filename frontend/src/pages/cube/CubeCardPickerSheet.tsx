import { useId, useState } from 'react';
import { X, Search } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { CardPreview } from '../../components/CardPreview';
import { useCardThumb } from '../../lib/card-thumbs';
import type { CubeCard } from '../../lib/cube/core';
import { cubeCardToEnriched } from './shared';
import { Button, IconButton } from '../../components/shared/Button';

export interface CubeCardCandidate {
  card: CubeCard;
  reason?: string;
}

/**
 * The shared sheet for both "Swap this card" and "Add from collection" —
 * a bottom sheet on phone / centred dialog on desktop (STYLE_GUIDE Pattern B,
 * `modal-backdrop--sheet`; a departure from the mockup's row-anchored desktop
 * popover, reusing the same shell `ShareDialog`/`ListRuleEditor` already use
 * on this page rather than building a second overlay mechanism). Lists ranked
 * `candidates`; tapping a row previews the card, "Use"/"Add" applies at once.
 */
export function CubeCardPickerSheet({
  title,
  subtitle,
  candidates,
  loading,
  error,
  onRetry,
  emptyMessage,
  pickLabel,
  search,
  onPick,
  onClose,
}: {
  title: string;
  subtitle?: string;
  candidates: CubeCardCandidate[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  emptyMessage: string;
  pickLabel: string;
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  onPick: (card: CubeCard) => void;
  onClose: () => void;
}) {
  const [previewCard, setPreviewCard] = useState<CubeCard | null>(null);
  const titleId = useId();

  return (
    <Modal
      onClose={onClose}
      className="modal cube-picker-dialog"
      backdropClassName="modal-backdrop--sheet"
      labelledBy={titleId}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton
          className="modal-close"
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
          onClick={onClose}
        />
      </div>
      <div className="modal-body cube-picker-body">
        {subtitle && <p className="cube-picker-subtitle">{subtitle}</p>}
        {search && (
          <label className="cube-picker-search">
            <Search width={14} height={14} strokeWidth={2} aria-hidden />
            <span className="sr-only">{search.placeholder}</span>
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
            />
          </label>
        )}
        {loading && (
          <div className="cube-skeleton" role="status" aria-busy="true">
            <div className="deck-analysis-skeleton-bar is-headline" />
            <div className="deck-analysis-skeleton-bar is-body" />
            <div className="deck-analysis-skeleton-bar is-body is-short" />
          </div>
        )}
        {!loading && error && (
          <div className="cube-error" role="alert">
            {error}
            <Button variant="link" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {!loading && !error && candidates.length === 0 && (
          <p className="cube-picker-empty">{emptyMessage}</p>
        )}
        {!loading && !error && candidates.length > 0 && (
          <ul className="cube-picker-list">
            {candidates.map(({ card, reason }) => (
              <CubePickerRow
                key={card.oracleId}
                card={card}
                reason={reason}
                pickLabel={pickLabel}
                onPreview={() => setPreviewCard(card)}
                onPick={() => onPick(card)}
              />
            ))}
          </ul>
        )}
      </div>

      {previewCard && (
        <CardPreview
          source="collection"
          cards={[cubeCardToEnriched(previewCard)]}
          index={0}
          binderName={title}
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={() => {}}
          onClose={() => setPreviewCard(null)}
        />
      )}
    </Modal>
  );
}

function CubePickerRow({
  card,
  reason,
  pickLabel,
  onPreview,
  onPick,
}: {
  card: CubeCard;
  reason?: string;
  pickLabel: string;
  onPreview: () => void;
  onPick: () => void;
}) {
  const thumb = useCardThumb(card.name, 'small');
  return (
    <li className="cube-picker-row">
      <button
        type="button"
        className="cube-picker-row-interactive"
        aria-label={`Preview ${card.name}`}
        onClick={onPreview}
      >
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="cube-row-thumb" />
        ) : (
          <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
        )}
        <span className="cube-picker-row-body">
          <span className="cube-row-name">{card.name}</span>
          {reason && <span className="cube-row-reason">{reason}</span>}
        </span>
      </button>
      <Button onClick={onPick}>{pickLabel}</Button>
    </li>
  );
}

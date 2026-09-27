import { useId } from 'react';
import { Button } from '@/components/shared/Button';
import { SectionIcon } from './deck-display-icons';
import './CommanderOpenSlot.css';

/**
 * The command zone of a commander-format deck that has cards but no commander
 * yet (E465). The Commander section keeps its place at the top of the list,
 * where the commander will appear, and shows an open slot with the one door
 * that fills it. Drawn dashed, the same "not filled yet" idiom as the Blank
 * tile in BinderStartChooser. The copy says what's true now (every color shows
 * in search) rather than warning: an unfinished deck isn't a broken one.
 */
export function CommanderOpenSlot({ onChoose }: { onChoose: () => void }) {
  const titleId = useId();
  return (
    <section className="deck-section commander-open-slot" aria-labelledby={titleId}>
      <header className="deck-section-header">
        <span className="deck-section-icon">
          <SectionIcon icon="commander" />
        </span>
        <div className="deck-section-title-row">
          <h3 id={titleId} className="deck-section-title">
            Commander <span className="deck-section-count">(0)</span>
          </h3>
        </div>
      </header>
      <div className="commander-open-slot-row">
        <span className="commander-open-slot-ghost" aria-hidden>
          ?
        </span>
        <div className="commander-open-slot-body">
          <p className="commander-open-slot-title">No commander yet</p>
          <p className="commander-open-slot-detail">
            <span className="commander-open-slot-detail-long">
              Choose one when you&apos;re ready. Until then, every color shows.
            </span>
            <span className="commander-open-slot-detail-short">
              Every color shows until you choose.
            </span>
          </p>
        </div>
        <Button
          variant="primary"
          className="commander-open-slot-choose"
          aria-label="Choose a commander"
          onClick={onChoose}
        >
          Choose
        </Button>
      </div>
    </section>
  );
}

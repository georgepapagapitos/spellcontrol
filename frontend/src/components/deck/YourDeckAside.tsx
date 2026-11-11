import './YourDeckAside.css';
import { Button } from '@/components/shared/Button';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  card: ScryfallCard;
  partner: ScryfallCard | null;
  /** Label and value of each choice made so far, in step order. */
  recap: ReadonlyArray<readonly [string, string]>;
  hint: string;
  /** Why the buttons are held, when something is (an ineligible commander, a color not chosen). */
  blocking: string | null;
  error: string | null;
  generateLabel: string;
  isBuilding: boolean;
  publishing: boolean;
  /** Start blank needs only a buildable commander. */
  canBuild: boolean;
  /** Generate also needs the method's own settings (an art motif). */
  canGenerate: boolean;
  /** Either action is in flight. */
  busy: boolean;
  onBlank: () => void;
  onGenerate: () => void;
}

/**
 * "Your deck" (E1113): the sticky recap beside the steps on a wide screen, with the two ways
 * to finish. The same two buttons live in the bottom bar below 1024px; the page renders one or
 * the other, never both.
 */
export function YourDeckAside({
  card,
  partner,
  recap,
  hint,
  blocking,
  error,
  generateLabel,
  isBuilding,
  publishing,
  canBuild,
  canGenerate,
  busy,
  onBlank,
  onGenerate,
}: Props) {
  const art = useCardThumb(card.name, 'art_crop');
  return (
    <aside className="your-deck" aria-label="Your deck" data-surface="sleeve">
      <div className="your-deck-art" aria-hidden>
        {art && <img src={art} alt="" />}
      </div>
      <h2 className="your-deck-title">Your deck</h2>
      <dl className="your-deck-recap">
        {recap.map(([label, value]) => (
          <div key={label} className="your-deck-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="your-deck-hint">{hint}</p>
      <div role="group" aria-label="Build this deck" className="your-deck-actions">
        {blocking && (
          <p className="your-deck-blocking" role="status">
            {blocking}
          </p>
        )}
        {error && (
          <div className="error-banner deck-builder-error" role="alert">
            {error}
          </div>
        )}
        <Button
          variant="primary"
          className="your-deck-generate"
          onClick={onGenerate}
          disabled={busy || !canGenerate}
        >
          {isBuilding ? 'Building…' : publishing ? 'Publishing…' : generateLabel}
        </Button>
        <Button onClick={onBlank} disabled={busy || !canBuild}>
          {publishing ? 'Creating…' : 'Start blank'}
        </Button>
      </div>
      {partner && <span className="sr-only">With partner {partner.name}</span>}
    </aside>
  );
}

import { useMemo } from 'react';
import { Boxes, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { buildAvailableCollection } from '../../lib/collection-availability';

/**
 * `/decks/cube/new` — the start chooser (STYLE_GUIDE § Config surfaces: "a new
 * X with presets starts from a chooser… a mode that shares almost nothing
 * with the default is a start of its own"). The three old CubePage tabs
 * become three starts, chosen once.
 */
export function CubeChooserPage() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const saved = useCubeStore((s) => s.saved);
  const eligible = useMemo(
    () => buildAvailableCollection(collectionCards, decks, saved).names.size,
    [collectionCards, decks, saved]
  );

  return (
    <div className="cube-page">
      <BackLink to="/decks/cube" label="Cubes" />
      <PageHeader title="New cube" />
      <div className="cube-chooser">
        <Link to="/decks/cube/new/collection" className="cube-chooser-tile">
          <Boxes
            className="cube-chooser-icon"
            width={20}
            height={20}
            strokeWidth={1.6}
            aria-hidden
          />
          <span className="cube-chooser-title">From my collection</span>
          <p className="cube-chooser-desc">
            Draw from your owned cards, and up to 3 friends' collections: best cards, or lean into
            what your collection can support.
          </p>
          {eligible > 0 && (
            <p className="cube-chooser-note">
              <strong>{eligible.toLocaleString()}</strong> eligible singles right now
            </p>
          )}
        </Link>
        <Link to="/decks/cube/new/import" className="cube-chooser-tile">
          <LinkIcon
            className="cube-chooser-icon"
            width={20}
            height={20}
            strokeWidth={1.6}
            aria-hidden
          />
          <span className="cube-chooser-title">Import a cube</span>
          <p className="cube-chooser-desc">
            Paste a public CubeCobra link. See what you already own, then build your own version
            from what's missing.
          </p>
        </Link>
      </div>
    </div>
  );
}

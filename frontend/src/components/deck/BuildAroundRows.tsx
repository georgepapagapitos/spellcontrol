import './BuildAroundRows.css';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/shared/Button';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { MIN_COLLECTION_SIZE } from '@/lib/deck/commander-readiness';
import {
  collectionCouldBuild,
  ownedTypeCounts,
  type Idea,
  type IdeaIndex,
} from '@/lib/deck/idea-index';
import { formatCount } from '@/lib/util/format-count';
import { useCollectionStore } from '@/store/collection';

/** Ideas a row shows before its "All N". */
const ROW_SHOWN = 7;

interface Props {
  index: IdeaIndex;
  onPick: (idea: Idea) => void;
}

/**
 * "Build around" (E1113): the finder's way into the idea list while no idea is applied and
 * nothing is typed. Each chip applies the idea as a filter on the one commander grid below.
 */
export function BuildAroundRows({ index, onPick }: Props) {
  const collection = useCollectionStore((s) => s.cards);
  const typal = useMemo(() => index.ideas.filter((i) => i.kind === 'typal'), [index]);
  const playstyles = useMemo(() => index.ideas.filter((i) => i.kind === 'playstyle'), [index]);
  const owned = useMemo(() => {
    if (collection.length < MIN_COLLECTION_SIZE) return [];
    return collectionCouldBuild(ownedTypeCounts(collection, typal), index, ROW_SHOWN);
  }, [collection, typal, index]);
  return (
    <div className="build-around">
      <Row label="Creature types" ideas={typal} onPick={onPick} />
      <Row label="Ways to play" ideas={playstyles} onPick={onPick} />
      {owned.length > 0 && (
        <Row
          label="From your cards"
          ideas={owned.map((o) => o.idea)}
          owned={new Map(owned.map((o) => [o.idea.slug, o.owned]))}
          onPick={onPick}
        />
      )}
    </div>
  );
}

function Row({
  label,
  ideas,
  owned,
  onPick,
}: {
  label: string;
  ideas: Idea[];
  owned?: ReadonlyMap<string, number>;
  onPick: (idea: Idea) => void;
}) {
  const [all, setAll] = useState(false);
  const labelId = useId();
  const listId = useId();
  const shown = all ? ideas : ideas.slice(0, ROW_SHOWN);
  return (
    <div className="build-around-row" role="group" aria-labelledby={labelId}>
      <span className="build-around-label" id={labelId}>
        {label}
      </span>
      <ul className="build-around-list" id={listId}>
        {shown.map((idea) => (
          <li key={idea.slug}>
            <IdeaChoice idea={idea} owned={owned?.get(idea.slug)} onPick={() => onPick(idea)} />
          </li>
        ))}
      </ul>
      {ideas.length > ROW_SHOWN && (
        <Button
          variant="link"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Fewer' : `All ${ideas.length}`}
        </Button>
      )}
    </div>
  );
}

function IdeaChoice({ idea, owned, onPick }: { idea: Idea; owned?: number; onPick: () => void }) {
  const art = useCardThumb(idea.card, 'art_crop');
  return (
    <button type="button" className="build-around-choice" onClick={onPick}>
      <span className="build-around-art" aria-hidden>
        {art && <img src={art} alt="" loading="lazy" />}
      </span>
      <span className="build-around-name">{idea.name}</span>
      <span className="build-around-note">
        {owned !== undefined
          ? `You own ${formatCount(owned)}`
          : `${formatCount(idea.decks)} ${idea.decks === 1 ? 'deck' : 'decks'}`}
      </span>
    </button>
  );
}

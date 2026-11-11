import './BuildAroundRows.css';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { fetchCommanderThemes } from '@/deck-builder/services/edhrec/client';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import {
  ideaKindLabel,
  ownedTypeCounts,
  relatedIdeas,
  type Idea,
  type IdeaIndex,
} from '@/lib/deck/idea-index';
import { formatCount } from '@/lib/util/format-count';
import { useCollectionStore } from '@/store/collection';

/** Leading commanders whose themes feed "Pairs well with". */
const RELATED_FROM = 3;

interface Props {
  idea: Idea;
  index: IdeaIndex;
  /** Names the idea's list leads with, most built first; the source of "Pairs well with". */
  leaders: readonly string[];
  onIdea: (idea: Idea) => void;
  /** "Pick one for me": null while the list loads or when it is empty. */
  onPickForMe: (() => void) | null;
  busy: boolean;
}

/**
 * The strip under the filters while an idea is applied (E1113): what the idea is, how built
 * it is, what the collection holds of it, and the ideas that tend to share its commanders.
 */
export function IdeaStrip({ idea, index, leaders, onIdea, onPickForMe, busy }: Props) {
  const collection = useCollectionStore((s) => s.cards);
  const art = useCardThumb(idea.card, 'art_crop');
  const ownedOfType = useMemo(
    () => (idea.type ? (ownedTypeCounts(collection, [idea]).get(idea.slug) ?? 0) : 0),
    [collection, idea]
  );
  const leaderKey = leaders.slice(0, RELATED_FROM).join('|');
  const [related, setRelated] = useState<{ key: string; ideas: Idea[] } | null>(null);
  useEffect(() => {
    if (!leaderKey) return;
    let cancelled = false;
    void (async () => {
      const lists = await Promise.all(
        leaderKey.split('|').map((n) => fetchCommanderThemes(n).catch(() => []))
      );
      if (!cancelled) {
        setRelated({ key: `${idea.slug}|${leaderKey}`, ideas: relatedIdeas(index, idea, lists) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leaderKey, idea, index]);
  const pairs = related?.key === `${idea.slug}|${leaderKey}` ? related.ideas : [];

  return (
    <div className="idea-strip">
      <div className="idea-strip-main">
        <span className="idea-strip-art" aria-hidden>
          {art && <img src={art} alt="" />}
        </span>
        <div className="idea-strip-body">
          <div className="idea-strip-title">
            <Chip className="commander-result-fact" tone="neutral">
              {ideaKindLabel(idea.kind)}
            </Chip>
            <span className="idea-strip-name">{idea.name}</span>
          </div>
          <p className="idea-strip-facts">
            {formatCount(idea.decks)} decks across {formatCount(idea.commanders)} commanders.
            {ownedOfType > 0 && (
              <>
                {' '}
                <span className="idea-strip-own">
                  You own {formatCount(ownedOfType)}{' '}
                  {(ownedOfType === 1 ? (idea.type ?? idea.name) : idea.name).toLowerCase()}.
                </span>
              </>
            )}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={onPickForMe ?? undefined}
          disabled={!onPickForMe || busy}
        >
          {busy ? 'Opening…' : 'Pick one for me'}
        </Button>
      </div>
      {pairs.length > 0 && (
        <div className="idea-strip-pairs" role="group" aria-label="Pairs well with">
          <span className="build-around-label">Pairs well with</span>
          <ul className="build-around-list">
            {pairs.map((p) => (
              <li key={p.slug}>
                <Button onClick={() => onIdea(p)}>{p.name}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

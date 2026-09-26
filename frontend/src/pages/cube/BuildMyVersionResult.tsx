import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CardGridCell } from '../../components/shared/CardGridCell';
import { CardPreview } from '../../components/CardPreview';
import { NameInputDialog } from '../../components/NameInputDialog';
import { SaveToListDialog } from '../../components/SaveToListDialog';
import { useCollectionStore } from '../../store/collection';
import { useCubeStore } from '../../store/cube';
import { useToastsStore } from '../../store/toasts';
import { getCardsByNames } from '../../deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { isTrackingList } from '../../lib/lists';
import { bucketOf } from '../../lib/cube/core';
import { COLOR_LABEL } from '../../lib/cube/swap';
import { DEFAULT_POOL_FILTERS } from '../../lib/cube/pool-filters';
import type { BuildMyVersionResult as BuildMyVersionData } from '../../lib/cube/build-my-version';
import type { CubeCobraCard, ImportedCube } from '../../lib/cube/import';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { cubeCardToEnriched, pickToPreviewCard } from './shared';
import { Button } from '../../components/shared/Button';

/** Why a card got no substitute — the same bucket/color language `buildMyVersion`
 *  already uses for a swap's reason, so "why" reads consistently either way. */
function missingReason(card: CubeCobraCard): string {
  const bucket = bucketOf({
    name: card.name,
    oracleId: card.oracleId,
    colors: card.colors,
    cmc: card.cmc,
    typeLine: card.typeLine,
    role: null,
  });
  const label = COLOR_LABEL[bucket] ?? bucket;
  return `No ${label} card in your collection matched this slot.`;
}

type PreviewState = { group: 'kept' | 'swapped' | 'nomatch'; index: number } | null;

/**
 * The "Build my version" result: what stayed, what got swapped for the
 * closest owned match (both sides named, never a bare arrow — STYLE_GUIDE
 * "Comparing two of anything"), and what has no match at all. Saving snapshots
 * it as a new cube; the cards you don't own (every swap's original plus every
 * no-match) can go straight to a want list via the app's existing list store.
 */
export function BuildMyVersionResult({
  imported,
  result,
  enrichedMap,
}: {
  imported: ImportedCube;
  result: BuildMyVersionData;
  enrichedMap: Map<string, ScryfallCard>;
}) {
  const navigate = useNavigate();
  const pushToast = useToastsStore((s) => s.push);
  const saveDirectly = useCubeStore((s) => s.saveDirectly);
  const listsAll = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const addListEntries = useCollectionStore((s) => s.addListEntries);

  const totalRows = result.kept.length + result.substituted.length + result.missing.length;

  const keptCards = useMemo(
    () => result.kept.map((c) => pickToPreviewCard(c, enrichedMap)),
    [result.kept, enrichedMap]
  );
  // Reading order matches the trade preview's give-then-get ruling: the card
  // leaving the list, then the one replacing it.
  const swappedCards = useMemo<EnrichedCard[]>(
    () =>
      result.substituted.flatMap((s) => [
        cubeCardToEnriched(s.original),
        pickToPreviewCard(s.substitute, enrichedMap),
      ]),
    [result.substituted, enrichedMap]
  );
  const missingCards = useMemo(
    () => result.missing.map((c) => cubeCardToEnriched(c)),
    [result.missing]
  );

  const [preview, setPreview] = useState<PreviewState>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const handleSave = useCallback(
    (name: string) => {
      const id = saveDirectly(name, result.cube.size, result.cube, false, [], {
        synergyLevel: 0,
        filters: DEFAULT_POOL_FILTERS,
      });
      setSaveOpen(false);
      pushToast({ message: `Saved "${name}"`, tone: 'success' });
      navigate(`/decks/cube/${id}`);
    },
    [saveDirectly, result.cube, pushToast, navigate]
  );

  // Everything the build didn't keep: every swap's original plus every
  // no-match — the cards this cube still needs from somewhere else.
  const wantCards = useMemo(
    () => [...result.substituted.map((s) => s.original), ...result.missing],
    [result.substituted, result.missing]
  );
  const lists = useMemo(() => listsAll.filter((l) => !l.rule && !isTrackingList(l)), [listsAll]);
  const [listOpen, setListOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const handleSendToList = useCallback(
    async (target: { listId: string } | { newName: string }) => {
      setSending(true);
      try {
        const listId = 'listId' in target ? target.listId : createList(target.newName);
        const names = [...new Set(wantCards.map((c) => c.name))];
        const scryfall = await getCardsByNames(names);
        const cards: { card: EnrichedCard; quantity: number }[] = [];
        let unresolved = 0;
        for (const c of wantCards) {
          const s = scryfall.get(c.name);
          if (!s) {
            unresolved += 1;
            continue;
          }
          cards.push({ card: scryfallToEnrichedCard(s), quantity: 1 });
        }
        const { added, skipped } = await addListEntries(listId, cards);
        setListOpen(false);
        const listName =
          useCollectionStore.getState().lists.find((l) => l.id === listId)?.name ?? 'list';
        const parts = [
          added > 0 && `Added ${added} ${added === 1 ? 'card' : 'cards'} to "${listName}"`,
          skipped > 0 && `${skipped} already there`,
          unresolved > 0 && `${unresolved} couldn't be matched`,
        ].filter((s): s is string => Boolean(s));
        pushToast({
          message: parts.length > 0 ? parts.join(' · ') : `Nothing new to add to "${listName}"`,
          tone: added > 0 ? 'success' : 'info',
        });
      } finally {
        setSending(false);
      }
    },
    [wantCards, createList, addListEntries, pushToast]
  );

  return (
    <section className="cube-result cube-my-version" aria-label="Your version of the cube">
      <div className="cube-result-head">
        <div>
          <h2>My version of {imported.name}</h2>
          <p className="cube-result-sub">
            You own {result.kept.length} of {totalRows}. {result.substituted.length} swapped for
            your closest match. {result.missing.length} have no match.
          </p>
          {result.requestedSize !== result.cube.size && (
            <p className="cube-result-sub">
              The original has {result.requestedSize} cards. Your version is a {result.cube.size}
              -card cube.
            </p>
          )}
        </div>
        <div className="cube-result-actions">
          <Button variant="primary" onClick={() => setSaveOpen(true)}>
            Save this cube
          </Button>
          {wantCards.length > 0 && (
            <Button onClick={() => setListOpen(true)} disabled={sending}>
              Send {wantCards.length} missing {wantCards.length === 1 ? 'card' : 'cards'} to a want
              list
            </Button>
          )}
        </div>
      </div>

      {result.kept.length > 0 && (
        <div className="cube-mv-group">
          <h3>
            Kept <span className="cube-group-count">({result.kept.length})</span>
          </h3>
          <div className="cube-gallery">
            {result.kept.map((c, i) => (
              <CardGridCell
                key={c.oracleId || c.name}
                card={keptCards[i]}
                qty={1}
                size="1x"
                onActivate={() => setPreview({ group: 'kept', index: i })}
              />
            ))}
          </div>
        </div>
      )}

      {result.substituted.length > 0 && (
        <div className="cube-mv-group">
          <h3>
            Swapped <span className="cube-group-count">({result.substituted.length})</span>
          </h3>
          <ul className="cube-sub-rows">
            {result.substituted.map((s, i) => {
              const sub = enrichedMap.get(s.substitute.name);
              const subImg = sub?.image_uris?.small ?? sub?.card_faces?.[0]?.image_uris?.small;
              return (
                <li key={s.original.oracleId || s.original.name} className="cube-sub-row">
                  <button
                    type="button"
                    className="cube-sub-side"
                    aria-label={`Open preview for ${s.original.name}`}
                    onClick={() => setPreview({ group: 'swapped', index: i * 2 })}
                  >
                    {s.original.image ? (
                      <img
                        src={s.original.image}
                        alt=""
                        loading="lazy"
                        className="cube-row-thumb"
                      />
                    ) : (
                      <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                    )}
                    <span className="cube-sub-name">{s.original.name}</span>
                  </button>
                  <ArrowRight
                    className="cube-sub-arrow"
                    width={14}
                    height={14}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <button
                    type="button"
                    className="cube-sub-side"
                    aria-label={`Open preview for ${s.substitute.name}`}
                    onClick={() => setPreview({ group: 'swapped', index: i * 2 + 1 })}
                  >
                    {subImg ? (
                      <img src={subImg} alt="" loading="lazy" className="cube-row-thumb" />
                    ) : (
                      <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                    )}
                    <span className="cube-sub-body">
                      <span className="cube-sub-name">{s.substitute.name}</span>
                      <span className="cube-row-reason">{s.reason}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {result.missing.length > 0 && (
        <div className="cube-mv-group">
          <h3>
            No match <span className="cube-group-count">({result.missing.length})</span>
          </h3>
          <ul className="cube-rows cube-mv-nomatch-rows">
            {result.missing.map((c, i) => (
              <li key={c.oracleId || c.name} className="cube-row">
                <button
                  type="button"
                  className="cube-row-interactive"
                  aria-label={`Open preview for ${c.name}`}
                  onClick={() => setPreview({ group: 'nomatch', index: i })}
                >
                  {c.image ? (
                    <img src={c.image} alt="" loading="lazy" className="cube-row-thumb" />
                  ) : (
                    <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                  )}
                  <div className="cube-row-body">
                    <span className="cube-row-title">
                      <span className="cube-row-name">{c.name}</span>
                    </span>
                    <span className="cube-row-reason">{missingReason(c)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview?.group === 'kept' && keptCards[preview.index] && (
        <CardPreview
          source="collection"
          cards={keptCards}
          index={preview.index}
          binderName="Cube"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={(index) => setPreview({ group: 'kept', index })}
          onClose={() => setPreview(null)}
        />
      )}
      {preview?.group === 'swapped' && swappedCards[preview.index] && (
        <CardPreview
          source="collection"
          cards={swappedCards}
          index={preview.index}
          binderName="Cube"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={(index) => setPreview({ group: 'swapped', index })}
          onClose={() => setPreview(null)}
        />
      )}
      {preview?.group === 'nomatch' && missingCards[preview.index] && (
        <CardPreview
          source="collection"
          cards={missingCards}
          index={preview.index}
          binderName="Cube"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={(index) => setPreview({ group: 'nomatch', index })}
          onClose={() => setPreview(null)}
        />
      )}

      {saveOpen && (
        <NameInputDialog
          title="Save this cube"
          label="Cube name"
          initialValue={`${imported.name} (my version)`}
          confirmLabel="Save"
          onSubmit={handleSave}
          onCancel={() => setSaveOpen(false)}
        />
      )}
      {listOpen && (
        <SaveToListDialog
          cardCount={wantCards.length}
          lists={lists}
          onSubmit={handleSendToList}
          onCancel={() => setListOpen(false)}
        />
      )}
    </section>
  );
}

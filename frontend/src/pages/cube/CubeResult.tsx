import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Lock,
  LockOpen,
  ArrowLeftRight,
  Ban,
  Trash2,
} from 'lucide-react';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { useStoredView } from '../../lib/use-stored-view';
import { StackedBar } from '../../components/shared/MeterBar';
import { CardGridCell } from '../../components/shared/CardGridCell';
import { DeckBadge } from '../../components/DeckBadge';
import { CardPreview } from '../../components/CardPreview';
import { OverflowMenu } from '../../components/OverflowMenu';
import { formatRelativeTime } from '../../lib/format-time';
import type { AllocationInfo } from '../../lib/allocations';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { ColorBucket, sizeInfo, provenance } from '../../lib/cube/targets';
import { GeneratedCube } from '../../lib/cube/generate';
import { samplePack } from '../../lib/cube/sample-pack';
import { nextSeed } from '../../lib/playtest/rng';
import type { SavedCube } from '../../store/cube';
import { Ownership } from '../../lib/cube/import';
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_COLOR,
  OwnRowBadge,
  CubeArchetypes,
  pickToPreviewCard,
  groupPicksByBucket,
} from './shared';
import { CubeHealthPanel } from './CubeHealthPanel';
import { Button, IconButton } from '../../components/shared/Button';
import { CubeSuppliers } from './CubeSuppliers';
import { Chip } from '@/components/shared/Chip';

/** "180 cards · 4 players · saved 1h ago · Physical · 180 reserved" — the one
 *  line that identifies a saved cube, on its row AND over the result it's loaded into. */
export function SavedCubeMeta({ sc }: { sc: SavedCube }) {
  return (
    <>
      {sc.size} cards · {sizeInfo(sc.size).players} players
      {sc.cube.format === 'commander' && ' · Commander'} · saved {formatRelativeTime(sc.savedAt)}
      {sc.isPhysical && (
        <span className="cube-saved-physical-tag">
          {' · '}
          {sc.picks.filter((p) => p.allocatedCopyId).length} reserved
        </span>
      )}
    </>
  );
}

/** Row-level editing on the cube's own page (CubeDetailPage): lock, swap,
 *  remove, ban. `pickIndex` throughout is the index into `cube.picks`. */
export interface CubeEditHandlers {
  locked: Set<string>;
  onToggleLock: (oracleId: string, name: string) => void;
  onSwap: (pickIndex: number) => void;
  onRemove: (pickIndex: number) => void;
  onBan: (pickIndex: number) => void;
}

export function CubeResult({
  cube,
  onCopy,
  onSave,
  loaded,
  ownershipFor,
  committedFor,
  enrichedMap,
  hideTitle,
  hideCopyAction,
  edit,
  supplierMap,
  myUsername = '',
}: {
  cube: GeneratedCube;
  onCopy: () => void;
  onSave: () => void;
  /** The saved cube this result is, or null for a fresh unsaved build. */
  loaded: SavedCube | null;
  ownershipFor: (name: string) => Ownership;
  committedFor: (name: string) => AllocationInfo[];
  enrichedMap: Map<string, ScryfallCard>;
  /** The cube's own page already has a header with the name — skip the
   *  duplicate title/sub line and render just the sections + actions. */
  hideTitle?: boolean;
  /** The cube's own page moved "Copy cube list" into the header actions. */
  hideCopyAction?: boolean;
  /** Row editing — present only on the cube's own page (a saved cube). */
  edit?: CubeEditHandlers;
  /** oracleId -> usernames who can supply that pick, when this cube drew from
   *  one or more friends' collections. Absent/empty on a solo build. */
  supplierMap?: ReadonlyMap<string, string[]>;
  myUsername?: string;
}) {
  const built = cube.picks.length;
  const segments = BUCKET_ORDER.filter((b) => cube.byBucket[b] > 0).map((b) => ({
    key: b,
    value: cube.byBucket[b],
    color: BUCKET_COLOR[b],
    title: `${BUCKET_LABEL[b]}: ${cube.byBucket[b]}`,
  }));
  const shorts = cube.gaps.filter((g) => g.severity === 'short');
  const notes = cube.gaps.filter((g) => g.severity === 'note');

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Gallery (image grid) vs list (rows + reasons). Gallery scans a 360–720-card
  // cube in a fraction of the scroll; list keeps the per-card "why".
  const [view, setView] = useStoredView<'gallery' | 'list'>(
    'cube-result-view',
    ['gallery', 'list'],
    'gallery'
  );
  // Color sections you've collapsed (ephemeral — a navigation aid, not a setting).
  const [collapsed, setCollapsed] = useState<Set<ColorBucket>>(new Set());
  const toggleBucket = (b: ColorBucket) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  // Flat list of all picks (for preview carousel index mapping).
  const allPicks = cube.picks;

  // Build EnrichedCard[] parallel to allPicks for CardPreview.
  const previewCards = useMemo<EnrichedCard[]>(
    () => allPicks.map((p) => pickToPreviewCard(p.card, enrichedMap)),
    [allPicks, enrichedMap]
  );

  // Sample pack: closed by default so it never pushes "The cards" down the
  // page. `packSeed` stays null until first opened, so the pack is stable
  // across re-renders; "Deal another" is the only thing that advances it.
  const [packOpen, setPackOpen] = useState(false);
  const [packSeed, setPackSeed] = useState<number | null>(null);
  const [packPreviewIndex, setPackPreviewIndex] = useState<number | null>(null);
  const [dealCount, setDealCount] = useState(0);
  const togglePack = () => {
    if (!packOpen && packSeed === null) {
      setPackSeed(Math.floor(Math.random() * 0xffffffff));
      setDealCount(1);
    }
    setPackOpen((v) => !v);
  };
  const dealAnother = () => {
    setPackSeed((s) => nextSeed(s ?? Date.now()));
    setDealCount((n) => n + 1);
  };
  const pack = useMemo(
    () => (packSeed === null ? null : samplePack(cube.picks, packSeed)),
    [cube.picks, packSeed]
  );
  const packPreviewCards = useMemo<EnrichedCard[]>(
    () => (pack ? pack.map((p) => pickToPreviewCard(p.card, enrichedMap)) : []),
    [pack, enrichedMap]
  );

  const groups = useMemo(() => groupPicksByBucket(allPicks), [allPicks]);
  // On the cube's own page (hideTitle + hideCopyAction), a loaded cube has
  // neither a title (the page header already has it) nor an action button
  // here (Save doesn't apply; Copy moved to the page header) — skip the row
  // entirely rather than leaving an empty flex child that still eats a gap.
  const showHead = !hideTitle || !loaded || !hideCopyAction;

  // Friends who supplied at least one pick, for the "Drawn from" sub-line —
  // derived from supplierMap (the single source of truth) rather than a
  // separate prop, so it can never disagree with the "Who brings what" panel.
  const otherSuppliers = useMemo(() => {
    if (!supplierMap) return [];
    const set = new Set<string>();
    for (const suppliers of supplierMap.values())
      for (const s of suppliers) if (s !== myUsername) set.add(s);
    return [...set];
  }, [supplierMap, myUsername]);

  return (
    <section className="cube-result" aria-label="Generated cube">
      {showHead && (
        <div className={`cube-result-head${hideTitle ? ' cube-result-head--actions-only' : ''}`}>
          {!hideTitle && (
            <div>
              <h2>
                {loaded
                  ? loaded.name
                  : `${built}-card ${cube.format === 'commander' ? 'Commander cube' : 'cube'}`}
                {built < cube.size && (
                  <span className="cube-short-tag"> ({cube.size - built} short)</span>
                )}
              </h2>
              <p className="cube-result-sub">
                {loaded ? (
                  <SavedCubeMeta sc={loaded} />
                ) : otherSuppliers.length > 0 ? (
                  <>
                    Drawn from {cube.poolSize.toLocaleString()} eligible singles owned by{' '}
                    {new Intl.ListFormat('en', { type: 'conjunction' }).format([
                      'you',
                      ...otherSuppliers,
                    ])}
                    .
                  </>
                ) : (
                  <>Drawn from {cube.poolSize.toLocaleString()} eligible singles you own.</>
                )}
              </p>
            </div>
          )}
          <div className="cube-result-actions">
            {/* A loaded cube is already saved — offering "Save cube" again only
              minted duplicates. Rename / physical / delete live on its row. */}
            {!loaded && (
              <Button variant="primary" onClick={onSave}>
                Save cube
              </Button>
            )}
            {!hideCopyAction && <Button onClick={onCopy}>Copy cube list</Button>}
          </div>
        </div>
      )}

      {supplierMap && supplierMap.size > 0 && (
        <CubeSuppliers cube={cube} supplierMap={supplierMap} myUsername={myUsername} />
      )}

      <div className="cube-balance">
        <h3>Color balance</h3>
        <StackedBar segments={segments} size="md" />
        <ul className="cube-legend">
          {BUCKET_ORDER.filter((b) => cube.byBucket[b] + cube.targetByBucket[b] > 0).map((b) => (
            <li key={b}>
              <span className="cube-swatch" style={{ background: BUCKET_COLOR[b] }} aria-hidden />
              {BUCKET_LABEL[b]}: <strong>{cube.byBucket[b]}</strong>
              <span className="cube-legend-target"> / {cube.targetByBucket[b]} target</span>
            </li>
          ))}
        </ul>
      </div>

      <CubeArchetypes score={cube.score} />

      <CubeHealthPanel cube={cube} />

      <div className="cube-gaps">
        <h3>Where your collection lands</h3>
        {shorts.length === 0 && notes.length === 0 && (
          <p className="cube-gap cube-gap-note">
            This cube fits the template for its size cleanly.
          </p>
        )}
        {shorts.map((g, i) => (
          <p key={`s${i}`} className="cube-gap cube-gap-short">
            {g.text}
          </p>
        ))}
        {notes.map((g, i) => (
          <p key={`n${i}`} className="cube-gap cube-gap-note">
            {g.text}
          </p>
        ))}
        <p className="cube-provenance">
          Targets derived from{' '}
          {Object.entries(provenance.bands)
            .filter(([band]) => (band === 'commander') === (cube.format === 'commander'))
            .reduce((a, [, b]) => a + b.n, 0)}{' '}
          popular CubeCobra {cube.format === 'commander' ? 'Commander ' : 'draft '}cubes (updated{' '}
          {provenance.generatedAt.slice(0, 10)}).
        </p>
      </div>

      <div className="cube-sample-pack">
        <h3 className="cube-sample-pack-head">
          <button
            type="button"
            className="cube-sample-pack-toggle"
            aria-expanded={packOpen}
            aria-controls={packOpen ? 'cube-sample-pack-body' : undefined}
            onClick={togglePack}
          >
            <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
            Sample pack
          </button>
        </h3>
        {packOpen && pack && (
          <div id="cube-sample-pack-body" className="cube-sample-pack-body">
            <p className="cube-sample-pack-sub">
              {pack.length} card{pack.length === 1 ? '' : 's'} drawn at random from this cube.
            </p>
            <span className="sr-only" aria-live="polite">
              Pack {dealCount} dealt, {pack.length} cards.
            </span>
            <div className="cube-gallery">
              {pack.map((p, i) => (
                <CardGridCell
                  key={`${p.card.oracleId || p.card.name}-${dealCount}`}
                  card={packPreviewCards[i]}
                  qty={1}
                  size="1x"
                  onActivate={() => setPackPreviewIndex(i)}
                />
              ))}
            </div>
            <Button className="cube-sample-pack-deal" onClick={dealAnother}>
              Deal another pack
            </Button>
          </div>
        )}
      </div>

      <div className="cube-list">
        <div className="cube-list-head">
          <h3>The cards</h3>
          <ViewModeToggle<'gallery' | 'list'>
            ariaLabel="Cube card view"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'gallery',
                label: 'Gallery view',
                icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'list',
                label: 'List view (with reasons)',
                icon: <LayoutList width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>
        {groups.map(({ bucket, items }, groupIndex) => {
          const isCollapsed = collapsed.has(bucket);
          return (
            <div
              key={bucket}
              className="cube-group"
              style={{ '--group-index': groupIndex } as React.CSSProperties}
            >
              <h4 className="cube-group-head">
                <button
                  type="button"
                  className="cube-group-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleBucket(bucket)}
                >
                  <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
                  <span
                    className="cube-swatch"
                    style={{ background: BUCKET_COLOR[bucket] }}
                    aria-hidden
                  />
                  {BUCKET_LABEL[bucket]} <span className="cube-group-count">{items.length}</span>
                </button>
              </h4>
              {!isCollapsed &&
                (view === 'gallery' ? (
                  <div className="cube-gallery">
                    {items.map(({ pick: p, flatIndex }) => {
                      const isLocked = edit?.locked.has(p.card.oracleId) ?? false;
                      return (
                        <CardGridCell
                          key={p.card.oracleId || p.card.name}
                          card={previewCards[flatIndex]}
                          qty={1}
                          size="1x"
                          onActivate={() => setPreviewIndex(flatIndex)}
                          badges={
                            <>
                              {isLocked && (
                                <span
                                  className="card-list-deck-badge"
                                  title='Locked, stays on "Rebuild the rest"'
                                  aria-label='Locked, stays on "Rebuild the rest"'
                                >
                                  <Lock width={11} height={11} strokeWidth={2} aria-hidden />
                                </span>
                              )}
                              <DeckBadge allocations={committedFor(p.card.name)} />
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <ul className="cube-rows">
                    {items.map(({ pick: p, flatIndex }) => {
                      const own = ownershipFor(p.card.name);
                      const s = enrichedMap.get(p.card.name);
                      const img = s?.image_uris?.small ?? s?.card_faces?.[0]?.image_uris?.small;
                      const isLocked = edit?.locked.has(p.card.oracleId) ?? false;
                      // A friend-only pick (I don't supply it myself) shows who does
                      // instead of the ownership badge — "not owned" would say less.
                      const suppliers = p.card.oracleId
                        ? supplierMap?.get(p.card.oracleId)
                        : undefined;
                      const friendSuppliers = suppliers
                        ? suppliers.filter((u) => u !== myUsername)
                        : [];
                      const iSupply = !suppliers || suppliers.includes(myUsername);
                      return (
                        <li
                          key={p.card.oracleId || p.card.name}
                          className={`cube-row${isLocked ? ' cube-row-locked' : ''}`}
                        >
                          <button
                            type="button"
                            className="cube-row-interactive"
                            aria-label={`Open preview for ${p.card.name}`}
                            onClick={() => setPreviewIndex(flatIndex)}
                          >
                            {img ? (
                              <img src={img} alt="" loading="lazy" className="cube-row-thumb" />
                            ) : (
                              <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                            )}
                            <div className="cube-row-body">
                              <span className="cube-row-title">
                                <span className="cube-row-name">{p.card.name}</span>
                                {isLocked && (
                                  <span className="cube-row-locked-tag">
                                    <Lock width={10} height={10} strokeWidth={2} aria-hidden />
                                    Locked
                                  </span>
                                )}
                                {iSupply || friendSuppliers.length === 0 ? (
                                  // A cube is built from cards you own, so "Owned" on every
                                  // row is noise that truncates the name on a phone; the
                                  // row speaks only for the exceptions (in a deck, in
                                  // another cube).
                                  own !== 'owned' && <OwnRowBadge own={own} />
                                ) : (
                                  <Chip
                                    className="cube-collab-supplier-chip"
                                    aria-label={`Supplied by ${friendSuppliers.join(', ')}`}
                                  >
                                    {friendSuppliers[0]}
                                    {friendSuppliers.length > 1 && (
                                      <span aria-hidden> +{friendSuppliers.length - 1}</span>
                                    )}
                                  </Chip>
                                )}
                              </span>
                              {p.reason && <span className="cube-row-reason">{p.reason}</span>}
                            </div>
                          </button>
                          {edit && (
                            <div className="cube-row-acts">
                              <IconButton
                                className="card-edit-btn cube-row-lock-btn"
                                aria-pressed={isLocked}
                                label={`${isLocked ? 'Unlock' : 'Lock'} ${p.card.name}`}
                                title={
                                  isLocked
                                    ? 'Stays on "Rebuild the rest"'
                                    : 'Locks this card for "Rebuild the rest"'
                                }
                                icon={
                                  isLocked ? (
                                    <Lock width={15} height={15} strokeWidth={2} />
                                  ) : (
                                    <LockOpen width={15} height={15} strokeWidth={2} />
                                  )
                                }
                                onClick={() => edit.onToggleLock(p.card.oracleId, p.card.name)}
                              />
                              <IconButton
                                className="card-edit-btn"
                                label={`Swap ${p.card.name}`}
                                title="Swap for a ranked replacement"
                                icon={<ArrowLeftRight width={15} height={15} strokeWidth={2} />}
                                onClick={() => edit.onSwap(flatIndex)}
                              />
                              <OverflowMenu
                                triggerClassName="card-edit-btn"
                                ariaLabel={`More actions for ${p.card.name}`}
                                items={[
                                  {
                                    label: 'Remove from cube',
                                    icon: Trash2,
                                    onClick: () => edit.onRemove(flatIndex),
                                  },
                                  {
                                    label: 'Ban from this cube…',
                                    icon: Ban,
                                    danger: true,
                                    onClick: () => edit.onBan(flatIndex),
                                  },
                                ]}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </div>
          );
        })}
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Cube"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {packPreviewIndex !== null && packPreviewCards[packPreviewIndex] && (
        <CardPreview
          source="collection"
          cards={packPreviewCards}
          index={packPreviewIndex}
          binderName="Sample pack"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={setPackPreviewIndex}
          onClose={() => setPackPreviewIndex(null)}
        />
      )}
    </section>
  );
}

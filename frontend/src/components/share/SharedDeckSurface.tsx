import { useMemo, useState, type ReactNode } from 'react';
// This surface renders the OWNER's deck components (DeckDisplay, its rows and
// toolbar, DeckAnalysisView, the combo panel), whose classes live in the
// deck-builder stylesheets. The app is code-split per page, so a chunk only
// gets the stylesheets its own modules import — without these, a cold load of
// /d/:slug or /s/:token renders the list and panels unstyled. Guarded by
// `styles/css-chunk-ownership.test.ts`, which caught exactly that here.
import '@/styles/deck-builder-editor.css';
import '@/styles/deck-builder-combos-list.css';
import '@/styles/deck-builder-row-qty.css';
import '@/styles/deck-builder-analysis-panel.css';
import { Link, useSearchParams } from 'react-router-dom';
import { Swords } from 'lucide-react';
import type { PublicDeck } from '../../lib/shared-types';
import { publicDeckToDeck } from '../../lib/public-deck-to-deck';
import { formatIdentity } from '../../lib/display-name';
import { formatCount } from '../../lib/format-count';
import { renderMarkdownLite } from '../../lib/markdown-lite';
import { buildWinConditionSummary } from '../../lib/win-condition-summary';
import { toClockCard } from '../../lib/hand-classify';
import { effectiveBracket } from '../../store/decks';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { DeckDisplay, type DeckView } from '../deck/DeckDisplay';
import { DeckCombosPanel } from '../deck/DeckCombosPanel';
import { EnginePanel } from '../deck/EnginePanel';
import { PowerHero } from '../deck/PowerHero';
import { WinConditionPanel } from '../deck/WinConditionPanel';
import { ForkedFromBadge } from '../deck/ForkedFromBadge';
import { Tabs } from '../Tabs';
import { ReportDialog } from './ReportDialog';
import { CopyDeckButton } from './CopyDeckButton';
import { useAuth } from '../../store/auth';
import { useCollectionStore } from '../../store/collection';
import { useDeckCombos } from '../../lib/use-deck-combos';
import type { ChangeOwnership } from '../../lib/deck-change';
import type { CardOwnership } from './SharedCardTile';

// Below this, a platform count (views/copies) reads as more "ghost town" than
// informative, so each is hidden entirely rather than shown as a tiny number
// (social-plan ghost-town-threshold decision — see w1-public-profile-page,
// which applies the same 5-count floor to its deck-tile grid).
const GHOST_TOWN_COUNT_THRESHOLD = 5;

/**
 * Public-page-only metadata, present exclusively on the `/d/:slug` route —
 * absent on `/s/:token`. Turns the owner caption into a profile link,
 * surfaces the view/copy counts, and mounts a Report action.
 */
interface PublicMeta {
  slug: string;
  deckId: string;
  viewCount: number;
  copyCount: number;
}

interface Props {
  data: PublicDeck;
  /** Slug (`/d/:slug`) or share token (`/s/:token`) — namespaces local state. */
  sourceKey: string;
  publicMeta?: PublicMeta;
  /** Viewer's per-card ownership, keyed by card name — absent for a guest. */
  ownership?: Map<string, CardOwnership>;
  /** Rendered first inside <main> (the ownership-lens strip), so it shares the
   *  landmark and width math instead of sitting above it. */
  lead?: ReactNode;
}

/**
 * The deck view, for someone who does not own the deck.
 *
 * This renders `DeckDisplay` — the SAME component the owner's deck editor
 * renders — with the edit handlers simply not passed. There is no separate
 * read-only list component any more: the old `SharedDeckView` re-implemented a
 * thinner grid/list and steadily drifted from the real one, so a visitor saw a
 * worse deck page for no reason anyone had decided on.
 *
 * What a visitor gets: the full card list with its sorting, grouping, filters,
 * tags, search, hover/tap previews and export; the Stats tab; and the Power
 * tab (bracket, engine, win conditions, combos).
 *
 * What a visitor does not get, and why:
 *  - **Coach / AI review** — they coach the OWNER against the OWNER's
 *    collection, and the AI calls cost money per run.
 *  - **Table record** — the owner's own game history.
 *  - **Combos, for a signed-out guest** — `POST /api/combos/match` is
 *    `requireAuth`, so the panel is gated on being signed in, NOT on owning
 *    the deck. A signed-in visitor sees combos on someone else's deck.
 *  - **Every editing affordance** — row menus, qty steppers, add/remove, drag
 *    reorder, bracket target, win-con tagging. Each is gated by its handler
 *    being absent, so nothing renders disabled (which would imply the action
 *    exists for this viewer).
 */
export function SharedDeckSurface({ data, sourceKey, publicMeta, ownership, lead }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reportOpen, setReportOpen] = useState(false);
  const authed = useAuth((s) => s.status === 'authed');

  // One normalization boundary: the payload becomes the same `Deck` the owner's
  // surfaces consume, so every downstream component takes its real types.
  const deck = useMemo(() => publicDeckToDeck(data, sourceKey), [data, sourceKey]);

  const formatConfig = DECK_FORMAT_CONFIGS[deck.format];
  const hasCommander = !!formatConfig?.hasCommander;

  // Mainboard cards for the engine panel's axis drill-through, and a
  // per-physical-copy library for the win-condition assembly clock.
  const deckCards = useMemo(() => deck.cards.map((c) => c.card), [deck.cards]);
  const deckLibrary = useMemo(() => deckCards.map(toClockCard), [deckCards]);
  const axisSummaries = useMemo(
    () => (deck.synergyAnalysis ? analyzeDeckSynergy(deckCards).axes : undefined),
    [deck.synergyAnalysis, deckCards]
  );

  const deckOracleIds = useMemo(() => {
    const ids = new Set<string>();
    if (deck.commander?.oracle_id) ids.add(deck.commander.oracle_id);
    if (deck.partnerCommander?.oracle_id) ids.add(deck.partnerCommander.oracle_id);
    for (const c of deck.cards) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    for (const c of deck.sideboard) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    return Array.from(ids);
  }, [deck]);

  // Only commander decks carry an identity restriction — undefined disables the
  // hook's suggestion filter (an empty array would mean "colorless").
  const comboColorIdentity = useMemo(() => {
    if (!deck.commander && !deck.partnerCommander) return undefined;
    const ci = new Set<string>();
    for (const c of deck.commander?.color_identity ?? []) ci.add(c);
    for (const c of deck.partnerCommander?.color_identity ?? []) ci.add(c);
    return [...ci];
  }, [deck.commander, deck.partnerCommander]);

  // The VISITOR's own collection — so "one away, and you already own the
  // missing piece" works while reading someone else's deck, which is the whole
  // reason a combo list is interesting to a reader rather than an owner.
  const collectionCards = useCollectionStore((s) => s.cards);
  const ownedOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collectionCards) if (c.oracleId) ids.add(c.oracleId);
    return Array.from(ids);
  }, [collectionCards]);
  const ownedOracleIdSet = useMemo(() => new Set(ownedOracleIds), [ownedOracleIds]);

  // Gated on AUTH, not ownership: the match endpoint requires a session, so a
  // guest would only ever get a 401 and an error panel. Passing an empty id
  // list keeps the hook inert without breaking the rules-of-hooks order.
  const combosEnabled = authed && hasCommander;
  const comboData = useDeckCombos({
    deckOracleIds: combosEnabled ? deckOracleIds : [],
    ownedOracleIds,
    format: deck.format,
    colorIdentity: comboColorIdentity,
  });

  // One-away combos whose missing piece the visitor already owns. Same
  // `oneAway`-not-`almostInCollection` reasoning as the deck editor's copy
  // (see match.ts:112 — the latter is empty for decks carrying oracle ids).
  const comboOwnedMissingCount = useMemo(
    () =>
      (comboData.data?.oneAway ?? []).filter((m) => {
        const id = m.missingOracleIds[0];
        return id && ownedOracleIdSet.has(id);
      }).length,
    [comboData.data?.oneAway, ownedOracleIdSet]
  );

  // Bridge the share page's ownership lens into the shape DeckDisplay's rows
  // expect. Absent for a guest → no ownership chip renders anywhere.
  const ownershipFor = useMemo(() => {
    if (!ownership) return undefined;
    return (name: string): ChangeOwnership =>
      ownership.get(name)?.owned ? 'owned' : ('unowned' as const);
  }, [ownership]);

  // Power needs something to say. A deck nobody has ever analyzed carries none
  // of these, and an empty Power tab is worse than no Power tab.
  const hasPowerContent =
    hasCommander &&
    !!(
      deck.bracketEstimation ||
      deck.bracketOverride != null ||
      deck.planScore ||
      deck.synergyAnalysis ||
      deck.winConditions
    );

  const viewTabs: Array<{ id: DeckView; label: string }> = [
    { id: 'deck', label: 'Deck' },
    { id: 'stats', label: 'Stats' },
    ...(hasPowerContent ? [{ id: 'power' as DeckView, label: 'Power' }] : []),
  ];
  const requestedView = searchParams.get('view') as DeckView | null;
  const view: DeckView = viewTabs.some((t) => t.id === requestedView)
    ? (requestedView as DeckView)
    : 'deck';
  const setView = (next: DeckView) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'deck') params.delete('view');
    else params.set('view', next);
    // replace: flipping a tab shouldn't stack history entries between the
    // visitor and the Back button that returns them to where the link came from.
    setSearchParams(params, { replace: true });
  };

  // Where this deck lives, for the playtest link — /d/:slug for a published
  // deck, /s/:token for a share link. Both resolve to the same playtest page.
  const basePath = publicMeta ? `/d/${publicMeta.slug}` : `/s/${sourceKey}`;

  const mainboardCount =
    data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);

  const owner = formatIdentity({
    username: data.ownerUsername,
    displayName: data.ownerDisplayName,
  });
  const ownerLine = (
    <>
      Shared by {owner.primary}
      {owner.secondary && <span className="shared-view-owner-handle">{owner.secondary}</span>}
    </>
  );

  const viewLabel =
    publicMeta && publicMeta.viewCount >= GHOST_TOWN_COUNT_THRESHOLD
      ? `${formatCount(publicMeta.viewCount)} views`
      : null;
  const copyLabel =
    publicMeta && publicMeta.copyCount >= GHOST_TOWN_COUNT_THRESHOLD
      ? `${formatCount(publicMeta.copyCount)} copies`
      : null;
  const countsText = [viewLabel, copyLabel].filter((s): s is string => s != null).join(' · ');

  return (
    <main className="shared-view shared-deck-surface">
      {lead}
      <header className="shared-view-header">
        <p className="shared-view-owner">
          {publicMeta ? (
            <Link
              to={`/u/${data.ownerUsername}`}
              className="shared-view-owner-link"
              aria-label={`Shared by @${data.ownerUsername}: view profile`}
            >
              {ownerLine}
            </Link>
          ) : (
            ownerLine
          )}
        </p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.format} · {mainboardCount.toLocaleString()} cards
        </p>
        {mainboardCount > 0 && (
          <p className="shared-view-actions">
            <Link className="btn btn-primary" to={`${basePath}/playtest`}>
              <Swords width={15} height={15} strokeWidth={2} aria-hidden />
              Playtest this deck
            </Link>
          </p>
        )}
        {publicMeta && (
          <p className="shared-view-meta-row">
            {countsText && `${countsText} · `}
            <button
              type="button"
              className="btn-link"
              aria-label="Report this deck"
              onClick={() => setReportOpen(true)}
            >
              Report
            </button>
          </p>
        )}
      </header>

      {data.primer && (
        // renderMarkdownLite is escape-then-transform (see lib/markdown-lite.ts):
        // the whole string is HTML-entity-escaped before any tag is generated,
        // so the only tags it can ever emit are p/strong/em/ul/li — safe to
        // hand straight to dangerouslySetInnerHTML.
        <div
          className="shared-deck-primer"
          dangerouslySetInnerHTML={{ __html: renderMarkdownLite(data.primer) }}
        />
      )}
      {data.forkedFrom && <ForkedFromBadge forkedFrom={data.forkedFrom} />}

      {/* Same sticky underline tab bar the owner's deck page uses, so the two
          read as one surface rather than two designs of the same thing. */}
      <div className="shared-deck-surface-tabs">
        <Tabs
          ariaLabel="Deck views"
          variant="underline"
          value={view}
          onChange={setView}
          tabs={viewTabs.map((t) => ({
            id: t.id,
            label: t.label,
            controls: `deck-view-panel-${t.id}`,
          }))}
        />
      </div>

      <DeckDisplay
        title={deck.name}
        deckId={deck.id}
        format={deck.format}
        color={deck.color}
        commander={deck.commander}
        partnerCommander={deck.partnerCommander}
        cards={deck.cards}
        sideboard={deck.sideboard}
        activeView={view}
        ownershipFor={ownershipFor}
        // ── Deck-describing analysis, straight off the payload ──────────────
        bracketEstimation={deck.bracketEstimation}
        bracketOverride={deck.bracketOverride}
        archetypeOverride={deck.archetypeOverride}
        roleCounts={deck.roleCounts}
        roleTargets={deck.roleTargets}
        categoryTargets={deck.categoryTargets}
        rampSubtypeCounts={deck.rampSubtypeCounts}
        removalSubtypeCounts={deck.removalSubtypeCounts}
        boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
        cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
        cardInclusionMap={deck.cardInclusionMap}
        edhrecNumDecks={deck.edhrecNumDecks}
        planScore={deck.planScore}
        averageSalt={deck.averageSalt}
        saltiestCards={deck.saltiestCards}
        buildReport={deck.buildReport}
        // ── Power tab panels, each read-only by handler omission ────────────
        powerHeroSlot={
          hasPowerContent ? (
            <PowerHero
              bracket={effectiveBracket(deck) ?? null}
              bracketOverridden={deck.bracketOverride != null}
              bracketReasons={(deck.bracketEstimation?.hardFloors ?? []).map((f) => f.reason)}
              engineLabel={deck.synergyAnalysis?.axes[0]?.label}
              engineProducers={deck.synergyAnalysis?.axes[0]?.producers}
              enginePayoffs={deck.synergyAnalysis?.axes[0]?.payoffs}
              engineLopsided={(deck.synergyAnalysis?.warnings.length ?? 0) > 0}
              comboInDeck={comboData.data?.inDeck.length ?? 0}
              comboOwnedMissing={comboOwnedMissingCount}
              combosLoading={combosEnabled && comboData.loading}
              winConditionSummary={buildWinConditionSummary(deck.winConditions)}
              winConditionWarn={deck.winConditions?.noClearWinCondition}
              bracketOverride={deck.bracketOverride}
              // No onSetBracketOverride: the target is the owner's call, so the
              // pillar renders as a read-only statement of where the deck sits.
            />
          ) : undefined
        }
        engineSlot={
          deck.synergyAnalysis &&
          (deck.synergyAnalysis.warnings.length > 0 || deck.synergyAnalysis.axes.length > 0) ? (
            <EnginePanel
              analysis={deck.synergyAnalysis}
              showSuggestions={false}
              axisSummaries={axisSummaries}
              allCards={deckCards}
            />
          ) : undefined
        }
        winConditionSlot={
          deck.winConditions ? (
            <WinConditionPanel
              analysis={deck.winConditions}
              library={deckLibrary}
              winConTags={deck.winConTags}
            />
          ) : undefined
        }
        combosSlot={
          combosEnabled ? (
            <DeckCombosPanel
              embedded
              deckId={deck.id}
              deckOracleIds={deckOracleIds}
              format={deck.format}
              colorIdentity={comboColorIdentity}
            />
          ) : undefined
        }
      />

      {/* Copy acts on the whole deck, never the filtered view — a search that
          hides every row must not hide the way to take the deck. Only a
          genuinely cardless deck hides it (nothing to copy). Export isn't
          repeated here: DeckDisplay's own toolbar carries it at every width
          (a button ≥641px, its overflow menu below). */}
      {(mainboardCount > 0 || data.sideboard.length > 0) && (
        <CopyDeckButton data={data} variant="block" slug={publicMeta?.slug} />
      )}

      {publicMeta && reportOpen && (
        <ReportDialog
          kind="deck"
          targetId={publicMeta.deckId}
          onClose={() => setReportOpen(false)}
        />
      )}
    </main>
  );
}

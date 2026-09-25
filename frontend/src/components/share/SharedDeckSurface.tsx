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
import { Pencil, Swords } from 'lucide-react';
import type { PublicDeck } from '../../lib/shared-types';
import { publicDeckToDeck } from '../../lib/public-deck-to-deck';
import { formatIdentity } from '../../lib/display-name';
import { formatCount } from '../../lib/format-count';
import { renderMarkdownLite } from '../../lib/markdown-lite';
import { buildWinConditionSummary } from '../../lib/win-condition-summary';
import { toClockCard } from '../../lib/hand-classify';
import { formatMoney } from '../../lib/format-money';
import { useCurrency } from '../../lib/currency';
import { scryfallArtCrop } from '../../lib/offline/slim-to-scryfall';
import { deckValue } from '../../lib/deck-value';
import { effectiveBracket } from '../../store/decks';
import { bracketTextWithEstimate } from '../../lib/format-bracket-label';
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
import { partitionCombosByZone } from '../../lib/combo-zone-partition';
import type { ChangeOwnership } from '../../lib/deck-change';
import type { CardOwnership } from './SharedCardTile';
import { bracketReasons, bracketBorderline } from '@spellcontrol/deck-metrics';

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
  const currency = useCurrency();
  const authUsername = useAuth((s) => s.user?.username);

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

  // Commander(s) + mainboard only — see combo-zone-partition.ts. The combo
  // counts shown here (below) must agree with the owner's own bracket/coach,
  // which never counts a sideboard-completed combo either.
  const mainboardOracleIds = useMemo(() => {
    const ids = new Set<string>();
    if (deck.commander?.oracle_id) ids.add(deck.commander.oracle_id);
    if (deck.partnerCommander?.oracle_id) ids.add(deck.partnerCommander.oracle_id);
    for (const c of deck.cards) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    return ids;
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

  // Commander(s) + mainboard view of the raw match — a combo completed only
  // via a sideboard card doesn't count here either (see combo-zone-partition.ts).
  const partitionedCombos = useMemo(
    () => partitionCombosByZone(comboData.data, mainboardOracleIds),
    [comboData.data, mainboardOracleIds]
  );

  // One-away combos whose missing piece the visitor already owns. Same
  // `oneAway`-not-`almostInCollection` reasoning as the deck editor's copy
  // (see match.ts:112 — the latter is empty for decks carrying oracle ids).
  const comboOwnedMissingCount = useMemo(
    () =>
      partitionedCombos.oneAway.filter((m) => {
        const id = m.missingOracleIds[0];
        return id && ownedOracleIdSet.has(id);
      }).length,
    [partitionedCombos.oneAway, ownedOracleIdSet]
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

  // This deck is the viewer's own. Compared by username — the payload never
  // carries the owner's user id, and the deck id here is the owner's row id,
  // which is exactly what /decks/:id needs.
  const isOwnDeck = !!authUsername && authUsername === data.ownerUsername;

  const mainboardCount =
    data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);

  // Same hero the owner's deck page renders (.deck-editor-hero, DeckEditorPage):
  // commander art behind the title, the deck's colour on the left edge, and one
  // meta line of format · commander · cards · value · bracket. A visitor was
  // getting a plain caption-and-title block instead — the same deck, dressed as
  // a different product.
  const rawHeroArt =
    deck.commander?.image_uris?.art_crop ?? deck.commander?.card_faces?.[0]?.image_uris?.art_crop;
  const heroArt = rawHeroArt ? scryfallArtCrop(rawHeroArt) : undefined;
  const heroValue = useMemo(() => deckValue(deck, currency), [deck, currency]);
  const bracketValue = effectiveBracket(deck);
  // A stated bracket that differs from the estimate carries the estimate
  // alongside it — the same "shown to other people, so it can't hide the
  // estimate" rule the tiles and lists follow (2026-09-24 ruling). On Auto
  // bracketValue already IS the estimate, so nothing extra renders.
  const bracketHeroText =
    bracketValue != null
      ? deck.bracketOverride != null &&
        deck.bracketEstimation?.bracket != null &&
        deck.bracketEstimation.bracket !== bracketValue
        ? bracketTextWithEstimate(bracketValue, deck.bracketEstimation.bracket)
        : `Bracket ${bracketValue}`
      : null;

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
    <div className="shared-view shared-deck-surface">
      {lead}
      <header className="deck-editor-header shared-deck-header">
        <div
          className={`deck-editor-hero${heroArt ? ' deck-editor-hero--art' : ''}`}
          style={{ borderLeftColor: deck.color }}
        >
          {heroArt && (
            <span className="deck-editor-hero-artwrap" aria-hidden="true">
              <img className="deck-editor-hero-art" src={heroArt} alt="" loading="lazy" />
              <span className="deck-editor-hero-art-fade" />
            </span>
          )}
          <h1 className="binder-hero-name">{data.name}</h1>
          {/* \u00A0 glues each label to its value and each · to the segment
              before it, so the line only wraps between segments — the same
              treatment (and the same classes) as the owner's hero. */}
          <p className="binder-hero-meta">
            {formatConfig && <span className="deck-format-badge">{formatConfig.label}</span>}
            {deck.commander && (
              <>
                {formatConfig ? '\u00A0· ' : ''}
                {deck.commander.name}
                {deck.partnerCommander && ` +\u00A0${deck.partnerCommander.name}`}
              </>
            )}
            <span className="deck-hero-totals">
              {'\u00A0· '}
              {mainboardCount.toLocaleString()}
              {'\u00A0'}
              {mainboardCount === 1 ? 'card' : 'cards'}
              {heroValue > 0 && `\u00A0· ${formatMoney(heroValue, { currency })}`}
              {data.sideboard.length > 0 && `\u00A0· +${data.sideboard.length}\u00A0sideboard`}
            </span>
            {bracketHeroText && (
              <span className="deck-hero-bracket">{`\u00A0· ${bracketHeroText}`}</span>
            )}
          </p>
          {/* Byline, not a banner: whose deck this is belongs under the name,
              the way every other app credits an author — and the public page's
              counts and Report ride the same line rather than stacking two more
              rows of small print under it. */}
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
            {publicMeta && (
              <>
                {countsText && ` · ${countsText}`}
                {' · '}
                <button
                  type="button"
                  className="btn-link"
                  aria-label="Report this deck"
                  onClick={() => setReportOpen(true)}
                >
                  Report
                </button>
              </>
            )}
          </p>
          {data.forkedFrom && <ForkedFromBadge forkedFrom={data.forkedFrom} />}
        </div>
        <div className="shared-view-actions">
          {mainboardCount > 0 && (
            <Link className="btn btn-primary" to={`${basePath}/playtest`}>
              <Swords width={15} height={15} strokeWidth={2} aria-hidden />
              Playtest this deck
            </Link>
          )}
          {/* You can't edit someone else's deck, but you can take it: the copy
              lands in your own decks, editable, like any deck you made. */}
          {!isOwnDeck && (mainboardCount > 0 || data.sideboard.length > 0) && (
            <CopyDeckButton data={data} variant="header" slug={publicMeta?.slug} />
          )}
          {/* Viewing your OWN published deck. You get the visitor's view on
              purpose — it's the only way to see what you're actually
              publishing — but without this there is no route back to
              editing it, which strands the owner on a read-only page. */}
          {isOwnDeck && (
            <Link className="btn" to={`/decks/${data.id}`}>
              <Pencil width={15} height={15} strokeWidth={2} aria-hidden />
              Edit this deck
            </Link>
          )}
        </div>
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

      {/* Same sticky underline tab bar the owner's deck page uses, so the two
          read as one surface rather than two designs of the same thing. Stats
          sit under the list; with no Power tab there is nothing to switch to. */}
      {viewTabs.length > 1 && (
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
      )}

      <DeckDisplay
        title={deck.name}
        deckId={deck.id}
        format={deck.format}
        commander={deck.commander}
        partnerCommander={deck.partnerCommander}
        cards={deck.cards}
        sideboard={deck.sideboard}
        activeView={view}
        tabbed={viewTabs.length > 1}
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
              bracketEstimate={deck.bracketEstimation?.bracket ?? null}
              bracketReasons={deck.bracketEstimation ? bracketReasons(deck.bracketEstimation) : []}
              bracketBorderline={
                deck.bracketEstimation ? bracketBorderline(deck.bracketEstimation) : null
              }
              engineLabel={deck.synergyAnalysis?.axes[0]?.label}
              engineProducers={deck.synergyAnalysis?.axes[0]?.producers}
              enginePayoffs={deck.synergyAnalysis?.axes[0]?.payoffs}
              engineLopsided={(deck.synergyAnalysis?.warnings.length ?? 0) > 0}
              comboInDeck={partitionedCombos.mainboardComplete.length}
              comboOneAway={partitionedCombos.oneAway.length}
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
              mainboardOracleIds={mainboardOracleIds}
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
    </div>
  );
}

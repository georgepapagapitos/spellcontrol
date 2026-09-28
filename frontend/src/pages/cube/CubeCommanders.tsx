// The Commanders section (board #12, PR3): a Commander cube's legend
// section, shown directly above the spell buckets ("The cards") — a legend
// is chosen for what it enables as a commander, not where it slots on a
// curve, so it gets its own header + gallery/rows rather than mixing into
// the colour-bucket groups below (design doc § 4). Collapsed to one row of
// tiles (or rows) by default with a "See all N commanders" control — same
// "insight surfaces never displace content" idiom as Cube health /
// Draftability, just a peek instead of a one-line summary since the whole
// point here IS the cards. State is per page view (plain useState, not
// persisted) — a fresh visit always starts collapsed.
//
// Read-only: locking/swapping/banning a SPECIFIC legend isn't a thing the
// generator supports yet (`selectLegends` has no lock/ban awareness of its
// own) — a deliberate scope cut, not an oversight, so no edit affordance is
// offered here that would silently do nothing.
//
// `CommanderCoveragePanel` is the colour-identity coverage readout that
// replaces Draftability for a Commander cube (PR1 open question 6): a
// straight count of this cube's own commanders per identity. Board E461
// (PR4, the follow-up open question 6 itself deferred) adds the real
// simulation on top: opening the panel now ALSO seeds a Commander pod (see
// draft-sim.ts's `simulateCommanderDraft`) and reports how many drafters
// ended up with a commander and a real playable core around it (the same
// `COMMANDER_PLAYABLE_TARGET` bar the limited pod's own Draftability uses,
// not "did the draft alone fill all 59 other cards" — see that module's own
// doc for why). The panel "keeps its static
// grid and gains the simulation" (rather than forking a second disclosure
// next to it, or ripping the grid out) — same collapsed-by-default idiom as
// Draftability, same cache-on-`picks` idiom, one section that states the
// coverage fact when idle and upgrades to the simulated fact once it has run,
// never both at once. The shortfall fact itself still lives ONLY in "Where
// your collection lands" (./generate's gaps) — this panel doesn't restate it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Crown } from 'lucide-react';
import { CardGridCell } from '../../components/shared/CardGridCell';
import { CardPreview } from '../../components/CardPreview';
import { MeterBar } from '../../components/shared/MeterBar';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { COLORS, COLOR_PAIRS, type GeneratedCube } from '../../lib/cube/generate';
import { legendKindLabel, type LegendIdentity } from '../../lib/cube/legend';
import { simulateCommanderDraftAsync } from '../../lib/cube/generate-async';
import { COMMANDER_PLAYABLE_TARGET, type CommanderDraftSimResult } from '../../lib/cube/draft-sim';
import { sizeInfo } from '../../lib/cube/targets';
import { pickToPreviewCard } from './shared';
import { Button } from '../../components/shared/Button';
import { Chip } from '../../components/shared/Chip';

const ALL_IDENTITIES: LegendIdentity[] = [...COLORS, ...COLOR_PAIRS, 'other'];
/** "W" / "WU" / "3+" — plain letters, same "color is never the only signal"
 *  rule the draft-sim pips already follow, just without a color swatch at
 *  all here (a 16-cell grid of swatches would out-noise the letters). */
const IDENTITY_LABEL: Record<LegendIdentity, string> = (() => {
  const l = {} as Record<LegendIdentity, string>;
  for (const c of COLORS) l[c] = c;
  for (const p of COLOR_PAIRS) l[p] = p;
  l.other = '3+';
  return l;
})();

/** Roughly one gallery row at the widths this app supports — the approved
 *  mockup's own preview count (design doc § 4, mockup §3). */
const PREVIEW_COUNT = 6;

/** A crown badge, reusing the existing tile-corner badge chip (same one the
 *  gallery's "Locked" badge uses) so a Commander tile needs no new CSS.
 *  Exported — the sample pack (CubeResult) badges a drawn legend the same
 *  way, since both are just a `CardGridCell`'s `badges` prop. */
export function CommanderBadge() {
  return (
    <span className="card-list-deck-badge" title="Commander" aria-label="Commander">
      <Crown width={11} height={11} strokeWidth={2} aria-hidden />
    </span>
  );
}

/** Three states beyond "has a healthy legend section": no `legends` field at
 *  all (a Commander cube saved before board #12 PR1 shipped), and a `format`
 *  that isn't Commander (nothing to show). A present-but-thin section still
 *  renders normally — the "short" gap already covers that in "Where your
 *  collection lands" (see ./generate), so this section doesn't repeat it. */
function legendsStatus(cube: GeneratedCube): 'not-commander' | 'pre-legends' | 'ready' {
  if (cube.format !== 'commander') return 'not-commander';
  if (cube.legends === undefined) return 'pre-legends';
  return 'ready';
}

export function CubeCommandersSection({
  cube,
  view,
  enrichedMap,
}: {
  cube: GeneratedCube;
  view: 'gallery' | 'list';
  enrichedMap: Map<string, ScryfallCard>;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const status = legendsStatus(cube);
  const legends = cube.legends ?? [];
  const previewCards = useMemo<EnrichedCard[]>(
    () => legends.map((l) => pickToPreviewCard(l.card, enrichedMap)),
    [legends, enrichedMap]
  );
  const canExpand = legends.length > PREVIEW_COUNT;
  const visible = expanded ? legends : legends.slice(0, PREVIEW_COUNT);

  if (status === 'not-commander') return null;

  return (
    <div className="cube-commanders">
      <h3 className="cube-commanders-head">
        <Crown width={15} height={15} strokeWidth={2} aria-hidden />
        Commanders{' '}
        {status === 'ready' && <span className="cube-group-count">{legends.length}</span>}
      </h3>

      {status === 'pre-legends' && (
        <p className="cube-commanders-empty">
          This cube was built before Commander cubes had a legend section. Rebuild it to add one.
        </p>
      )}

      {status === 'ready' && legends.length === 0 && (
        <p className="cube-commanders-empty">
          No legendary creatures in your collection were eligible for this cube.
        </p>
      )}

      {status === 'ready' &&
        legends.length > 0 &&
        (view === 'gallery' ? (
          <div className="cube-gallery">
            {/* `visible` is always a PREFIX of `legends` (a slice(0, N), or
                the whole array once expanded), so its own index IS the index
                into `legends`/`previewCards` — no separate lookup needed. */}
            {visible.map((l, i) => (
              <CardGridCell
                key={l.card.oracleId || l.card.name}
                card={previewCards[i]}
                qty={1}
                size="1x"
                onActivate={() => setPreviewIndex(i)}
                badges={<CommanderBadge />}
                caption={legendKindLabel(l.card)}
              />
            ))}
          </div>
        ) : (
          <ul className="cube-rows">
            {visible.map((l, i) => {
              const s = enrichedMap.get(l.card.name);
              const img = s?.image_uris?.small ?? s?.card_faces?.[0]?.image_uris?.small;
              return (
                <li key={l.card.oracleId || l.card.name} className="cube-row">
                  <button
                    type="button"
                    className="cube-row-interactive"
                    aria-label={`Open preview for ${l.card.name}`}
                    onClick={() => setPreviewIndex(i)}
                  >
                    {img ? (
                      <img src={img} alt="" loading="lazy" className="cube-row-thumb" />
                    ) : (
                      <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                    )}
                    <div className="cube-row-body">
                      <span className="cube-row-title">
                        <span className="cube-row-name">{l.card.name}</span>
                        <span className="cube-row-identity">{IDENTITY_LABEL[l.identity]}</span>
                        {legendKindLabel(l.card) && (
                          <span className="cube-row-kind">{legendKindLabel(l.card)}</span>
                        )}
                      </span>
                      {l.reason && <span className="cube-row-reason">{l.reason}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      {status === 'ready' && canExpand && (
        <Button className="cube-commanders-see-all" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `See all ${legends.length} commanders`}
        </Button>
      )}

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="collection"
          cards={previewCards}
          index={previewIndex}
          binderName="Commanders"
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

/** In-memory cache keyed by the cube's own `picks` array — same idiom as
 *  CubeDraftabilityPanel's cache. `cube.legends` isn't part of the key: a
 *  legend section only ever changes alongside a full rebuild, which always
 *  hands out a new `picks` array too (locking/swapping/banning a SPELL never
 *  touches `legends` — see the module doc above), so `picks` alone already
 *  invalidates correctly on every case that matters. */
const simCache = new WeakMap<GeneratedCube['picks'], CommanderDraftSimResult>();

type SimStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'done'; result: CommanderDraftSimResult };

function toSimStatus(result: CommanderDraftSimResult | undefined): SimStatus {
  return result ? { kind: 'done', result } : { kind: 'idle' };
}

/**
 * Collapsed by default — same idiom as Cube health / Draftability right
 * above it (STYLE_GUIDE "insight surfaces never displace content"): the
 * summary line always states the headline fact, and opening it never moves
 * the spell buckets below further than that one line already did. States one
 * fact at a time: the static coverage count until a simulation has run, then
 * the simulated buildable share — never both stacked.
 */
export function CommanderCoveragePanel({ cube }: { cube: GeneratedCube }) {
  const [open, setOpen] = useState(false);
  const status = legendsStatus(cube);
  const legends = cube.legends ?? [];
  const counts = useMemo(() => {
    const c = {} as Record<LegendIdentity, number>;
    for (const id of ALL_IDENTITIES) c[id] = 0;
    for (const l of legends) c[l.identity]++;
    return c;
  }, [legends]);
  const coveredIdentityCount = ALL_IDENTITIES.filter((id) => counts[id] > 0).length;

  const [simStatus, setSimStatus] = useState<SimStatus>(() =>
    toSimStatus(simCache.get(cube.picks))
  );
  // Same "which identity a request is already running for" guard as
  // CubeDraftabilityPanel — not component state, so setting `simStatus` to
  // 'loading' can't itself re-trigger the effect below (see that panel's own
  // comment for the race this avoids).
  const startedFor = useRef<GeneratedCube['picks'] | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Re-sync straight from render when the cube identity changes under an open
  // panel — same "adjust state when a prop changes" pattern as
  // CubeDraftabilityPanel.
  const [syncedFor, setSyncedFor] = useState(cube.picks);
  if (syncedFor !== cube.picks) {
    setSyncedFor(cube.picks);
    setSimStatus(toSimStatus(simCache.get(cube.picks)));
  }

  useEffect(() => {
    if (!open || status !== 'ready' || !cube.legends || cube.legends.length === 0) return;
    const cached = simCache.get(cube.picks);
    if (cached) return; // synced by the effect above; nothing to start
    if (startedFor.current === cube.picks) return; // already running for this identity
    startedFor.current = cube.picks;
    let cancelled = false;
    setSimStatus({ kind: 'loading' });
    simulateCommanderDraftAsync(
      cube.picks.map((p) => p.card),
      cube.legends.map((l) => l.card),
      cube.size
    ).then(
      (result) => {
        if (cancelled) return;
        simCache.set(cube.picks, result);
        setSimStatus({ kind: 'done', result });
      },
      () => {
        if (cancelled) return;
        startedFor.current = null; // let a retry start a fresh request
        setSimStatus({ kind: 'error' });
      }
    );
    return () => {
      cancelled = true;
    };
    // retryToken is a manual re-trigger only — the effect doesn't read it.
  }, [open, cube.picks, cube.legends, cube.size, status, retryToken]);

  if (status === 'not-commander') return null;

  const summary =
    status === 'pre-legends'
      ? 'No legend section yet. Rebuild this cube to add one.'
      : legends.length === 0
        ? 'No commanders in this cube.'
        : simStatus.kind === 'done'
          ? `Simulated 50 drafts: ${Math.round(simStatus.result.builtDeckShare * 100)}% of drafters had a commander and ${COMMANDER_PLAYABLE_TARGET}+ playables in its colors.`
          : simStatus.kind === 'loading'
            ? 'Simulating…'
            : `${legends.length} commander${legends.length === 1 ? '' : 's'} across ${coveredIdentityCount} color identities.`;

  return (
    <div className="cube-commander-coverage">
      <h3 className="cube-commander-coverage-head">
        <button
          type="button"
          className="cube-commander-coverage-toggle"
          aria-expanded={open}
          aria-controls={open ? 'cube-commander-coverage-body' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
          Commander coverage
        </button>
      </h3>
      <p className="cube-commander-coverage-summary">{summary}</p>
      {open && status === 'ready' && legends.length > 0 && (
        <div id="cube-commander-coverage-body" className="cube-commander-coverage-body">
          <p className="cube-commander-coverage-sub">
            Legendary creatures in this cube, by color identity.
          </p>
          <div className="cube-coverage-grid">
            {ALL_IDENTITIES.map((id) => (
              <div key={id} className={`cube-coverage-cell${counts[id] === 0 ? ' is-low' : ''}`}>
                <div className="cube-coverage-label">{IDENTITY_LABEL[id]}</div>
                <div className="cube-coverage-count">{counts[id]}</div>
              </div>
            ))}
          </div>

          {simStatus.kind === 'loading' && (
            <p
              className="cube-commander-coverage-running"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              Simulating 50 drafts…
            </p>
          )}
          {simStatus.kind === 'error' && (
            <div className="cube-error" role="alert">
              Couldn't simulate the draft.
              <Button variant="link" onClick={() => setRetryToken((t) => t + 1)}>
                Retry
              </Button>
            </div>
          )}
          {simStatus.kind === 'done' && (
            <CommanderDraftSimReport result={simStatus.result} size={cube.size} />
          )}
        </div>
      )}
    </div>
  );
}

/** The simulation half of the panel's open body — the static grid above it
 *  already states legend counts, so this states the three metrics that need
 *  an actual draft to answer: whether a pod ends up with a commander and a
 *  real playable core, which identities got drafted as commander, and which
 *  ones nobody ever reached that core with. */
function CommanderDraftSimReport({
  result,
  size,
}: {
  result: CommanderDraftSimResult;
  size: GeneratedCube['size'];
}) {
  const pct = Math.round(result.builtDeckShare * 100);
  const builtCount = Math.round(result.builtDeckShare * result.totalDecks);
  const nominalPlayers = sizeInfo(size).players;
  const drafted = result.identityShares.filter((s) => s.share > 0);

  return (
    <>
      <p className="cube-commander-coverage-sim-sub">
        {`${result.runs} simulated ${result.playersPerRun}-player Commander drafts (3 packs of 15) off this cube.`}
        {result.shortCube &&
          ` This cube has fewer cards than a ${nominalPlayers}-player pod needs, so fewer players were drafted.`}
      </p>

      <div className="cube-commander-coverage-sim-stat">
        <div className="cube-commander-coverage-sim-stat-row">
          <span className="cube-commander-coverage-label">
            Commander and {COMMANDER_PLAYABLE_TARGET}+ playables
          </span>
          <strong className="cube-commander-coverage-sim-stat-value">{pct}%</strong>
        </div>
        <MeterBar value={result.builtDeckShare} max={1} />
        <p className="cube-commander-coverage-caption">
          {builtCount} of {result.totalDecks} drafted decks had a commander and at least{' '}
          {COMMANDER_PLAYABLE_TARGET} playables in its colors. Basics fill the rest of a 60-card
          deck.
        </p>
      </div>

      <div className="cube-commander-coverage-sim-identities">
        <p className="cube-commander-coverage-label">Drafted as commander</p>
        {drafted.length === 0 ? (
          <p className="cube-commander-coverage-caption">
            No drafter came away with a commander at all.
          </p>
        ) : (
          <ul className="cube-commander-coverage-identity-list">
            {drafted.map((s) => (
              <IdentityRow key={s.identity} identity={s.identity} share={s.share} />
            ))}
          </ul>
        )}
      </div>

      <div className="cube-commander-coverage-sim-unbuildable">
        <p className="cube-commander-coverage-label">
          Color identities nobody reached {COMMANDER_PLAYABLE_TARGET}+ playables in
        </p>
        {result.unbuildableIdentities.length === 0 ? (
          <p className="cube-commander-coverage-caption">
            Every color identity this cube supports reached {COMMANDER_PLAYABLE_TARGET}+ playables
            for someone.
          </p>
        ) : (
          <ul className="cube-commander-coverage-pill-list">
            {result.unbuildableIdentities.map((id) => (
              <Chip key={id} as="li" className="cube-commander-coverage-pill" tone="neutral">
                {IDENTITY_LABEL[id]}
              </Chip>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** One identity's "drafted as commander" row — plain text label (colour is
 *  never the only signal; there is no swatch here at all, same choice the
 *  static grid above already makes), a share meter, and the percentage. */
function IdentityRow({ identity, share }: { identity: LegendIdentity; share: number }) {
  const pct = share * 100;
  const pctText = pct > 0 && pct < 1 ? '<1' : String(Math.round(pct));
  return (
    <li className="cube-commander-coverage-identity-row">
      <span className="cube-commander-coverage-identity-label">{IDENTITY_LABEL[identity]}</span>
      <MeterBar value={share} max={1} className="cube-commander-coverage-identity-meter" />
      <span className="cube-commander-coverage-identity-pct">{pctText}%</span>
    </li>
  );
}

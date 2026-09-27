// The Commanders section (board #12, PR3): a Commander cube's legend
// section, shown above the spell buckets — a legend is chosen for what it
// enables as a commander, not where it slots on a curve, so it gets its own
// gallery/rows rather than mixing into the colour-bucket groups below (design
// doc § 4). Read-only: locking/swapping/banning a SPECIFIC legend isn't a
// thing the generator supports yet (`selectLegends` has no lock/ban
// awareness of its own) — a deliberate scope cut, not an oversight, so no
// edit affordance is offered here that would silently do nothing.
//
// `CommanderCoveragePanel` is the colour-identity coverage readout that
// replaces Draftability for a Commander cube (PR1 open question 6): a
// straight count of this cube's own commanders per identity, never a
// simulated draft — `draft-sim.ts`'s model (best 23-card deck in one
// 2-colour pair) has no notion of a singleton, colour-identity-restricted
// Commander deck.

import { useMemo, useState } from 'react';
import { ChevronDown, Crown } from 'lucide-react';
import { CardGridCell } from '../../components/shared/CardGridCell';
import { CardPreview } from '../../components/CardPreview';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { COLORS, COLOR_PAIRS, type GeneratedCube } from '../../lib/cube/generate';
import { LEGEND_TARGET, type LegendIdentity } from '../../lib/cube/legend';
import { pickToPreviewCard } from './shared';

const ALL_IDENTITIES: LegendIdentity[] = [...COLORS, ...COLOR_PAIRS, 'other'];
/** "W" / "WU" / "3+" — plain letters, same "colour is never the only signal"
 *  rule the draft-sim pips already follow, just without a colour swatch at
 *  all here (a 16-cell grid of swatches would out-noise the letters). */
const IDENTITY_LABEL: Record<LegendIdentity, string> = (() => {
  const l = {} as Record<LegendIdentity, string>;
  for (const c of COLORS) l[c] = c;
  for (const p of COLOR_PAIRS) l[p] = p;
  l.other = '3+';
  return l;
})();

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
  const status = legendsStatus(cube);
  const legends = cube.legends ?? [];
  const previewCards = useMemo<EnrichedCard[]>(
    () => legends.map((l) => pickToPreviewCard(l.card, enrichedMap)),
    [legends, enrichedMap]
  );

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
            {legends.map((l, i) => (
              <CardGridCell
                key={l.card.oracleId || l.card.name}
                card={previewCards[i]}
                qty={1}
                size="1x"
                onActivate={() => setPreviewIndex(i)}
                badges={<CommanderBadge />}
              />
            ))}
          </div>
        ) : (
          <ul className="cube-rows">
            {legends.map((l, i) => {
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
                      </span>
                      {l.reason && <span className="cube-row-reason">{l.reason}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

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

/**
 * Collapsed by default — same idiom as Cube health / Draftability right
 * above it (STYLE_GUIDE "insight surfaces never displace content"): the
 * summary line always states the headline fact, and opening it never moves
 * the spell buckets below further than that one line already did.
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

  if (status === 'not-commander') return null;

  const target = LEGEND_TARGET[cube.size];
  const summary =
    status === 'pre-legends'
      ? 'No legend section yet. Rebuild this cube to add one.'
      : legends.length === 0
        ? 'No commanders in this cube.'
        : `${legends.length} commander${legends.length === 1 ? '' : 's'} across ${ALL_IDENTITIES.filter((id) => counts[id] > 0).length} colour identities.`;

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
            Legendary creatures in this cube, by colour identity. A count of what's in the cube, not
            a simulated draft.
          </p>
          <div className="cube-coverage-grid">
            {ALL_IDENTITIES.map((id) => (
              <div key={id} className={`cube-coverage-cell${counts[id] === 0 ? ' is-low' : ''}`}>
                <div className="cube-coverage-label">{IDENTITY_LABEL[id]}</div>
                <div className="cube-coverage-count">{counts[id]}</div>
              </div>
            ))}
          </div>
          {legends.length < target && (
            <p className="cube-commander-coverage-note">
              {target - legends.length} short of the {target}-commander target for a {cube.size}
              -card cube. Own more legends to fill it out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

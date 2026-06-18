import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './CubePage.css';
import { Tabs } from '../components/Tabs';
import { StackedBar } from '../components/shared/MeterBar';
import { OwnershipBadge } from '../components/deck/OwnershipBadge';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useToastsStore } from '../store/toasts';
import { buildAllocationMap } from '../lib/allocations';
import { getCardsByNames } from '../deck-builder/services/scryfall/client';
import { loadTaggerData, getCardRole } from '../deck-builder/services/tagger/client';
import { CUBE_SIZES, CubeSize, SIZE_INFO, ColorBucket, provenance } from '../lib/cube/targets';
import { generateCube, GeneratedCube, CubeCard } from '../lib/cube/generate';
import { toCubeCobraList } from '../lib/cube/format';
import {
  fetchCubeCobraCube,
  overlayOwnership,
  ImportedCube,
  OwnershipOverlay,
  Ownership,
  CubeImportError,
} from '../lib/cube/import';

type Ownership3 = Ownership;

// Bucket display order, names, and segment colors for the balance bars.
const BUCKET_ORDER: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'];
const BUCKET_LABEL: Record<ColorBucket, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  multicolor: 'Multicolor',
  colorless: 'Colorless',
  land: 'Lands',
};
const BUCKET_COLOR: Record<ColorBucket, string> = {
  W: '#e8e0bf',
  U: '#3a7bd5',
  B: '#6b5b73',
  R: '#cb4b3f',
  G: '#3f9b6d',
  multicolor: '#c8a02e',
  colorless: '#9aa3ad',
  land: '#9c7a4d',
};

/** Build a tri-state `ownershipFor(name)` from the live collection + deck allocations. */
function useOwnershipFor() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  return useMemo(() => {
    const allocations = buildAllocationMap(decks);
    const byName = new Map<string, { free: number; claimed: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, claimed: 0 };
      if (allocations.get(copy.copyId)) e.claimed += 1;
      else e.free += 1;
      byName.set(key, e);
    }
    const ownershipFor = (name: string): Ownership3 => {
      const e = byName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      if (e.claimed > 0) return 'in-other-deck';
      return 'unowned';
    };
    return ownershipFor;
  }, [collectionCards, decks]);
}

export function CubePage() {
  const [mode, setMode] = useState<'build' | 'import'>('build');
  return (
    <div className="cube-page">
      <header className="cube-page-head">
        <h1>Cube workshop</h1>
        <p className="cube-page-sub">
          Build a draftable singleton cube from your collection, or import one from CubeCobra to see
          how much of it you own.
        </p>
      </header>
      <Tabs
        ariaLabel="Cube tools"
        variant="underline"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'build', label: 'Build from my collection' },
          { id: 'import', label: 'Import a cube' },
        ]}
      />
      <div role="tabpanel" aria-labelledby={`sc-tab-${mode}`} className="cube-panel">
        {mode === 'build' ? <BuildCube /> : <ImportCube />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build mode
// ---------------------------------------------------------------------------

function BuildCube() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const pushToast = useToastsStore((s) => s.push);
  const ownershipFor = useOwnershipFor();

  const [size, setSize] = useState<CubeSize>(540);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [cube, setCube] = useState<GeneratedCube | null>(null);

  const uniqueNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of collectionCards) if (c.name) set.add(c.name);
    return [...set];
  }, [collectionCards]);

  const generate = useCallback(async () => {
    setStatus('working');
    setError('');
    try {
      await loadTaggerData(); // ensures getCardRole is populated; cached/deduped
      const enriched = await getCardsByNames(uniqueNames);
      const ownedByName = new Map<string, (typeof collectionCards)[number]>();
      for (const c of collectionCards)
        if (c.name && !ownedByName.has(c.name)) ownedByName.set(c.name, c);
      const pool: CubeCard[] = uniqueNames.map((name) => {
        const card = ownedByName.get(name);
        const s = enriched.get(name);
        return {
          name,
          oracleId: s?.oracle_id ?? card?.oracleId ?? name.toLowerCase(),
          colors: s?.colors ?? card?.colors ?? [],
          cmc: s?.cmc ?? card?.cmc ?? 0,
          typeLine: s?.type_line ?? card?.typeLine ?? '',
          role: getCardRole(name),
          rank: s?.edhrec_rank ?? card?.edhrecRank,
        };
      });
      setCube(generateCube(pool, size));
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong building the cube.');
      setStatus('error');
    }
  }, [uniqueNames, collectionCards, size]);

  const copyList = useCallback(async () => {
    if (!cube) return;
    await navigator.clipboard.writeText(toCubeCobraList(cube.picks));
    pushToast({
      message: `Copied ${cube.picks.length} cards — paste into CubeCobra's Add Cards`,
      tone: 'success',
    });
  }, [cube, pushToast]);

  if (collectionCards.length === 0) {
    return (
      <div className="cube-empty">
        <p>You haven&apos;t imported a collection yet.</p>
        <Link to="/collection" className="cube-cta">
          Import your collection
        </Link>
        <p className="cube-empty-hint">
          A cube is built from the cards you own — bring them in first.
        </p>
      </div>
    );
  }

  return (
    <div className="cube-build">
      <div className="cube-controls">
        <div className="cube-size-picker" role="group" aria-label="Cube size">
          {CUBE_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={s === size ? 'cube-size active' : 'cube-size'}
              aria-pressed={s === size}
              onClick={() => setSize(s)}
            >
              <span className="cube-size-n">{s}</span>
              <span className="cube-size-sub">{SIZE_INFO[s].players} players</span>
            </button>
          ))}
        </div>
        <p className="cube-size-note">{SIZE_INFO[size].note}</p>
        <button
          type="button"
          className="cube-cta"
          onClick={generate}
          disabled={status === 'working'}
        >
          {status === 'working' ? 'Building…' : cube ? 'Rebuild cube' : 'Build cube'}
        </button>
        <p className="cube-pool-note">
          {uniqueNames.length.toLocaleString()} unique cards in your collection
        </p>
      </div>

      {status === 'working' && (
        <div className="cube-loading" aria-busy="true">
          Selecting your best cards and balancing the cube…
        </div>
      )}

      {status === 'error' && (
        <div className="cube-error" role="alert">
          {error}
          <button type="button" className="cube-link-btn" onClick={generate}>
            Try again
          </button>
        </div>
      )}

      {status === 'done' && cube && (
        <CubeResult cube={cube} onCopy={copyList} ownershipFor={ownershipFor} />
      )}
    </div>
  );
}

function CubeResult({
  cube,
  onCopy,
  ownershipFor,
}: {
  cube: GeneratedCube;
  onCopy: () => void;
  ownershipFor: (name: string) => Ownership3;
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

  const allPicks = cube.picks;
  const groups = useMemo(() => {
    const m = new Map<ColorBucket, typeof allPicks>();
    for (const b of BUCKET_ORDER) m.set(b, []);
    for (const p of allPicks) m.get(p.bucket)!.push(p);
    return BUCKET_ORDER.map((b) => ({ bucket: b, picks: m.get(b)! })).filter(
      (g) => g.picks.length > 0
    );
  }, [allPicks]);

  return (
    <section className="cube-result" aria-label="Generated cube">
      <div className="cube-result-head">
        <div>
          <h2>
            {built}-card cube
            {built < cube.size && (
              <span className="cube-short-tag"> ({cube.size - built} short)</span>
            )}
          </h2>
          <p className="cube-result-sub">
            Drawn from {cube.poolSize.toLocaleString()} eligible singles you own.
          </p>
        </div>
        <button type="button" className="cube-cta" onClick={onCopy}>
          Copy cube list
        </button>
      </div>

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
          Targets derived from {Object.values(provenance.bands).reduce((a, b) => a + b.n, 0)}{' '}
          popular CubeCobra cubes (updated {provenance.generatedAt.slice(0, 10)}).
        </p>
      </div>

      <div className="cube-list">
        <h3>The cards, and why</h3>
        {groups.map(({ bucket, picks }) => (
          <div key={bucket} className="cube-group">
            <h4 className="cube-group-head">
              <span
                className="cube-swatch"
                style={{ background: BUCKET_COLOR[bucket] }}
                aria-hidden
              />
              {BUCKET_LABEL[bucket]} <span className="cube-group-count">{picks.length}</span>
            </h4>
            <ul className="cube-rows">
              {picks.map((p) => {
                const own = ownershipFor(p.card.name);
                return (
                  <li key={p.card.oracleId || p.card.name} className="cube-row">
                    <span className="cube-row-name">{p.card.name}</span>
                    <span className="cube-row-reason">{p.reason}</span>
                    <OwnershipBadge
                      owned={own === 'owned'}
                      detail={own === 'in-other-deck' ? 'in a deck' : undefined}
                      title={
                        own === 'in-other-deck'
                          ? 'You own this, but it’s currently in a deck'
                          : undefined
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Import mode
// ---------------------------------------------------------------------------

type OwnFilter = 'all' | 'owned' | 'in-other-deck' | 'unowned';

function ImportCube() {
  const ownershipFor = useOwnershipFor();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cube: ImportedCube; overlay: OwnershipOverlay } | null>(
    null
  );
  const [filter, setFilter] = useState<OwnFilter>('all');

  const run = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('working');
    setError('');
    try {
      const cube = await fetchCubeCobraCube(url);
      const overlay = overlayOwnership(cube.cards, ownershipFor);
      setResult({ cube, overlay });
      setStatus('done');
    } catch (e) {
      setError(e instanceof CubeImportError ? e.message : 'Could not import that cube.');
      setStatus('error');
    }
  }, [url, ownershipFor]);

  const rows = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.overlay.rows;
    return result.overlay.rows.filter((r) => r.ownership === filter);
  }, [result, filter]);

  return (
    <div className="cube-import">
      <form
        className="cube-import-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          type="url"
          inputMode="url"
          className="cube-input"
          placeholder="https://cubecobra.com/cube/overview/…"
          aria-label="CubeCobra cube link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="cube-cta" disabled={status === 'working' || !url.trim()}>
          {status === 'working' ? 'Importing…' : 'Import'}
        </button>
      </form>

      {status === 'idle' && !result && (
        <p className="cube-import-hint">
          Paste a link to any public cube on CubeCobra. We&apos;ll match it against your collection
          so you can see exactly what you own and what you&apos;d need.
        </p>
      )}

      {status === 'working' && (
        <div className="cube-loading" aria-busy="true">
          Fetching the cube and matching your collection…
        </div>
      )}

      {status === 'error' && (
        <div className="cube-error" role="alert">
          {error}
        </div>
      )}

      {status === 'done' && result && (
        <section className="cube-result" aria-label="Imported cube ownership">
          <div className="cube-result-head">
            <div>
              <h2>{result.cube.name}</h2>
              <p className="cube-result-sub">
                {result.cube.cardCount} cards · {result.cube.likeCount.toLocaleString()} likes on
                CubeCobra
              </p>
            </div>
            <div className="cube-pct">
              <strong>{Math.round(result.overlay.pctComplete * 100)}%</strong>
              <span>you can build now</span>
            </div>
          </div>

          <div className="cube-balance">
            <StackedBar
              size="md"
              max={result.cube.cards.length}
              segments={[
                {
                  key: 'owned',
                  value: result.overlay.owned,
                  color: '#3f9b6d',
                  title: `Owned: ${result.overlay.owned}`,
                },
                {
                  key: 'deck',
                  value: result.overlay.inDeck,
                  color: '#c8a02e',
                  title: `In a deck: ${result.overlay.inDeck}`,
                },
                {
                  key: 'missing',
                  value: result.overlay.missing,
                  color: '#9aa3ad',
                  title: `Missing: ${result.overlay.missing}`,
                },
              ]}
            />
            <ul className="cube-legend">
              <li>
                <span className="cube-swatch" style={{ background: '#3f9b6d' }} aria-hidden />
                Owned <strong>{result.overlay.owned}</strong>
              </li>
              <li>
                <span className="cube-swatch" style={{ background: '#c8a02e' }} aria-hidden />
                In a deck <strong>{result.overlay.inDeck}</strong>
              </li>
              <li>
                <span className="cube-swatch" style={{ background: '#9aa3ad' }} aria-hidden />
                Missing <strong>{result.overlay.missing}</strong>
              </li>
            </ul>
          </div>

          <Tabs
            ariaLabel="Filter cards by ownership"
            variant="fitted"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'all', label: 'All', count: result.overlay.rows.length },
              { id: 'owned', label: 'Owned', count: result.overlay.owned },
              { id: 'in-other-deck', label: 'In a deck', count: result.overlay.inDeck },
              { id: 'unowned', label: 'Missing', count: result.overlay.missing },
            ]}
          />
          <ul className="cube-rows cube-import-rows">
            {rows.map((r) => (
              <li key={r.card.oracleId || r.card.name} className="cube-row">
                <span className="cube-row-name">{r.card.name}</span>
                <span className="cube-row-reason">{r.card.typeLine}</span>
                <OwnershipBadge
                  owned={r.ownership === 'owned'}
                  showUnowned
                  detail={r.ownership === 'in-other-deck' ? 'in a deck' : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

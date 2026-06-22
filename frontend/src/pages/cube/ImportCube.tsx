import React, { useCallback, useMemo, useState } from 'react';
import { Tabs } from '../../components/Tabs';
import { StackedBar } from '../../components/shared/MeterBar';
import { OwnershipBadge } from '../../components/deck/OwnershipBadge';
import { VerdictBadge } from '../../components/deck/VerdictBadge';
import { CardPreview } from '../../components/CardPreview';
import type { EnrichedCard } from '../../types';
import {
  fetchCubeCobraCube,
  overlayOwnership,
  ImportedCube,
  OwnershipOverlay,
  CubeImportError,
} from '../../lib/cube/import';
import { useOwnershipFor, CubeLoadingBlock, CubeErrorBlock } from './shared';

type OwnFilter = 'all' | 'owned' | 'in-other-deck' | 'unowned';

export function ImportCube() {
  const ownershipFor = useOwnershipFor();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cube: ImportedCube; overlay: OwnershipOverlay } | null>(
    null
  );
  const [filter, setFilter] = useState<OwnFilter>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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
    // The "In a deck" tab is the committed-elsewhere bucket — its count includes
    // cube-reserved copies, so the filter must match those too.
    if (filter === 'in-other-deck') {
      return result.overlay.rows.filter(
        (r) => r.ownership === 'in-other-deck' || r.ownership === 'in-cube'
      );
    }
    return result.overlay.rows.filter((r) => r.ownership === filter);
  }, [result, filter]);

  // Build EnrichedCard[] from import rows for CardPreview (minimal shape — no Scryfall fetch).
  const previewCards = useMemo<EnrichedCard[]>(() => {
    return rows.map((r) => ({
      copyId: r.card.oracleId || r.card.name.toLowerCase(),
      name: r.card.name,
      setCode: '',
      setName: '',
      collectorNumber: '',
      rarity: '',
      scryfallId: '',
      purchasePrice: 0,
      sourceCategory: '',
      sourceFormat: 'manual' as const,
      finish: 'nonfoil' as const,
      foil: false,
      oracleId: r.card.oracleId,
      cmc: r.card.cmc,
      typeLine: r.card.typeLine,
      colorIdentity: r.card.colors,
      colors: r.card.colors,
      imageSmall: r.card.image,
    }));
  }, [rows]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPreviewIndex(idx);
    }
  };

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
        <button
          type="submit"
          className="btn btn-primary"
          disabled={status === 'working' || !url.trim()}
        >
          {status === 'working' ? 'Importing…' : 'Import'}
        </button>
      </form>

      {status === 'idle' && !result && (
        <p className="cube-import-hint">
          Paste a link to any public cube on CubeCobra. We&apos;ll match it against your collection
          so you can see exactly what you own and what you&apos;d need.
        </p>
      )}

      {/* aria-live region: always in DOM so screen readers catch transitions */}
      <div aria-live="polite" aria-atomic="true">
        {status === 'working' && (
          <CubeLoadingBlock
            fetchProgress={null}
            finalizingLabel="Fetching the cube and matching your collection…"
          />
        )}

        {status === 'error' && <CubeErrorBlock error={error} onRetry={run} />}
      </div>

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
                  color: 'var(--success)',
                  title: `Owned: ${result.overlay.owned}`,
                },
                {
                  key: 'deck',
                  value: result.overlay.inDeck,
                  color: 'var(--warn-text)',
                  title: `In a deck: ${result.overlay.inDeck}`,
                },
                {
                  key: 'missing',
                  value: result.overlay.missing,
                  color: 'var(--text-muted)',
                  title: `Missing: ${result.overlay.missing}`,
                },
              ]}
            />
            <ul className="cube-legend">
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--success)' }}
                  aria-hidden
                />
                Owned <strong>{result.overlay.owned}</strong>
              </li>
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--warn-text)' }}
                  aria-hidden
                />
                In a deck <strong>{result.overlay.inDeck}</strong>
              </li>
              <li>
                <span
                  className="cube-swatch"
                  style={{ background: 'var(--text-muted)' }}
                  aria-hidden
                />
                Missing <strong>{result.overlay.missing}</strong>
              </li>
            </ul>
          </div>

          <Tabs
            ariaLabel="Filter cards by ownership"
            variant="fitted"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPreviewIndex(null);
            }}
            tabs={[
              { id: 'all', label: 'All', count: result.overlay.rows.length },
              { id: 'owned', label: 'Owned', count: result.overlay.owned },
              { id: 'in-other-deck', label: 'In a deck', count: result.overlay.inDeck },
              { id: 'unowned', label: 'Missing', count: result.overlay.missing },
            ]}
          />
          <ul className="cube-rows cube-import-rows">
            {rows.map((r, idx) => (
              <li
                key={r.card.oracleId || r.card.name}
                className="cube-row cube-row-interactive"
                role="button"
                tabIndex={0}
                aria-label={`${r.card.name} — open preview`}
                onClick={() => setPreviewIndex(idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
              >
                {r.card.image ? (
                  <img src={r.card.image} alt="" loading="lazy" className="cube-row-thumb" />
                ) : (
                  <span className="cube-row-thumb cube-row-thumb-ph" aria-hidden />
                )}
                <div className="cube-row-body">
                  <span className="cube-row-title">
                    <span className="cube-row-name">{r.card.name}</span>
                    {r.ownership === 'in-other-deck' ? (
                      <VerdictBadge
                        tone="neutral"
                        label="In a deck"
                        title="You own this, but it’s currently in a deck"
                      />
                    ) : r.ownership === 'in-cube' ? (
                      <VerdictBadge
                        tone="neutral"
                        label="In a cube"
                        title="You own this, but it’s reserved by a physical cube"
                      />
                    ) : (
                      <OwnershipBadge owned={r.ownership === 'owned'} showUnowned />
                    )}
                  </span>
                  <span className="cube-row-reason">{r.card.typeLine}</span>
                </div>
              </li>
            ))}
          </ul>

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
        </section>
      )}
    </div>
  );
}

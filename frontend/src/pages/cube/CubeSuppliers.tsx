import { useMemo } from 'react';
import { MeterBar } from '../../components/shared/MeterBar';
import type { GeneratedCube } from '../../lib/cube/generate';

interface SupplierRow {
  username: string;
  isMe: boolean;
  count: number;
  cardNames: string[];
}

/**
 * "Who brings what" — a per-person supply breakdown for a cube built from
 * friends' collections (board note: replaces Collab Cube's old contributor
 * pill row now that friends are a pool source on the main build page, not a
 * separate result view). Reads directly off `cube.picks` + `supplierMap`
 * rather than the map's own keys, so a stale supplier entry left behind by a
 * later lock/ban/swap edit is harmless — it just names an oracleId no pick
 * carries anymore, and this never iterates the map's keys directly.
 *
 * Rendered by `CubeResult` behind one line, so the card-list edits another
 * lane owns there stay a clean merge.
 */
export function CubeSuppliers({
  cube,
  supplierMap,
  myUsername,
}: {
  cube: GeneratedCube;
  supplierMap: ReadonlyMap<string, string[]>;
  myUsername: string;
}) {
  const rows = useMemo<SupplierRow[]>(() => {
    const byUser = new Map<string, string[]>();
    for (const p of cube.picks) {
      if (!p.card.oracleId) continue;
      const suppliers = supplierMap.get(p.card.oracleId);
      if (!suppliers) continue;
      for (const s of suppliers) {
        const list = byUser.get(s);
        if (list) list.push(p.card.name);
        else byUser.set(s, [p.card.name]);
      }
    }
    const list: SupplierRow[] = [...byUser.entries()].map(([username, cardNames]) => ({
      username,
      isMe: username === myUsername,
      count: cardNames.length,
      cardNames: [...cardNames].sort((a, b) => a.localeCompare(b)),
    }));
    list.sort((a, b) => (a.isMe !== b.isMe ? (a.isMe ? -1 : 1) : b.count - a.count));
    return list;
  }, [cube.picks, supplierMap, myUsername]);

  if (rows.length === 0) return null;

  return (
    <div className="cube-suppliers">
      <h3>Who brings what</h3>
      <ul className="cube-supplier-list">
        {rows.map((r) => (
          <li key={r.username} className="cube-supplier-row">
            <div className="cube-supplier-head">
              <span className="cube-supplier-name">{r.isMe ? 'You' : r.username}</span>
              <span className="cube-supplier-count">
                {r.count.toLocaleString()} card{r.count === 1 ? '' : 's'}
              </span>
            </div>
            <MeterBar
              value={r.count}
              max={cube.picks.length}
              size="sm"
              role="meter"
              label={`${r.isMe ? 'You supply' : `${r.username} supplies`} ${r.count} of ${cube.picks.length} cards`}
            />
            {r.count > 0 && (
              <details className="cube-supplier-details">
                <summary>Pull list</summary>
                <ul className="cube-supplier-cards">
                  {r.cardNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      <p className="cube-suppliers-note">
        A card supplied by more than one of you counts for each. Rebuilding updates these counts; a
        saved cube keeps the counts from when it was last built.
      </p>
    </div>
  );
}

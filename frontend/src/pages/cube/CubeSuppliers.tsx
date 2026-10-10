import { useMemo } from 'react';
import { MeterBar } from '../../components/shared/MeterBar';
import type { GeneratedCube } from '../../lib/cube/generate';
import { assignSuppliers } from '../../lib/cube/pool';

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
 * Each pick lands on exactly one person's pull list (`assignSuppliers`): a
 * card two of you own is one copy to bring, not two. Anyone who could supply
 * a pick still gets a row, at zero if every card they own went to someone
 * else, so the panel names the same people as the "Drawn from" line.
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
    const assigned = assignSuppliers(cube.picks, supplierMap, myUsername);
    const byUser = new Map<string, string[]>();
    for (const p of cube.picks) {
      if (!p.card.oracleId) continue;
      for (const s of supplierMap.get(p.card.oracleId) ?? []) {
        if (!byUser.has(s)) byUser.set(s, []);
      }
      const who = assigned.get(p.card.oracleId);
      if (who) byUser.get(who)?.push(p.card.name);
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
        Each card is on one list. You bring the cards you own, and a card only friends own goes to
        whoever has the fewest so far. A saved cube keeps the lists from its last build.
      </p>
    </div>
  );
}

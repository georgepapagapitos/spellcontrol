import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { SavedCube } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useBinderLayoutInputs } from '../../lib/use-binder-layout-inputs';
import { formatLocation } from '../../lib/card-locations';
import { useAwaitingFirstPull } from '../../lib/use-awaiting-first-pull';
import { safeLocalStorage } from '../../lib/safe-local-storage';
import {
  buildCubePullList,
  isPullableGroupKind,
  type CubePullGroup,
  type CubePullRow,
  type CubePullUnreservedReason,
} from '../../lib/cube/pull-list';
import { CubeErrorBlock } from './shared';
import { Button } from '../../components/shared/Button';

/** "A" / "A and B" / "A, B and C" — for naming the binder(s) that swallowed
 *  an 'out' group's copies. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The 'out' group's explanatory line, naming the binder(s) responsible —
 *  falls back to a generic phrasing on the (shouldn't-happen) case where
 *  `pull-list.ts` couldn't identify one. */
function outHint(binderNames: string[] | undefined): string {
  if (!binderNames || binderNames.length === 0) {
    return 'This binder hides cards held by a deck or a cube from its own view, so this copy is likely already pulled.';
  }
  const verb = binderNames.length === 1 ? 'leaves' : 'leave';
  return `${joinNames(binderNames)} ${verb} out cards held by a deck or cube, so these are likely already pulled.`;
}

const REASON_TEXT: Record<CubePullUnreservedReason, string> = {
  'not-owned': 'Not owned',
  'copy-missing': 'The reserved copy is no longer in your collection',
};

function ticksKey(cubeId: string): string {
  return `mtg-cube-pull-ticks-${cubeId}`;
}

/** Every read/write goes through `safeLocalStorage` (try/catch already built
 *  in) — a full or blocked store degrades to "ticks don't persist", never a
 *  crash. */
function loadTicks(cubeId: string): Set<string> {
  const raw = safeLocalStorage.getItem(ticksKey(cubeId));
  // safeLocalStorage's type allows StateStorage's async signature; the real
  // implementation is synchronous, but narrow explicitly rather than assume it.
  if (typeof raw !== 'string') return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

/** Split a binder group's rows (already sorted page-then-slot) into "Page N"
 *  runs — one pass, no re-sort. */
function pagesOf(rows: CubePullRow[]): { pageNum: number; rows: CubePullRow[] }[] {
  const pages: { pageNum: number; rows: CubePullRow[] }[] = [];
  for (const row of rows) {
    const pageNum = row.pageNum ?? 0;
    const last = pages[pages.length - 1];
    if (last && last.pageNum === pageNum) last.rows.push(row);
    else pages.push({ pageNum, rows: [row] });
  }
  return pages;
}

function CubePullRowItem({
  row,
  pullable,
  checked,
  onToggle,
  showSlot,
}: {
  row: CubePullRow;
  pullable: boolean;
  checked: boolean;
  onToggle: (key: string) => void;
  showSlot: boolean;
}) {
  const body = (
    <>
      <span className="cube-pull-row-body">
        <span className="cube-pull-row-name">{row.name}</span>
        {row.reason && <span className="cube-pull-row-hint">{REASON_TEXT[row.reason]}</span>}
      </span>
      {showSlot && row.slotNum !== undefined && (
        <span className="cube-pull-row-slot">Slot {row.slotNum}</span>
      )}
    </>
  );
  if (!pullable) {
    return (
      <div className="cube-pull-row cube-pull-row--info">
        <span className="cube-pull-check cube-pull-check--none" aria-hidden="true" />
        {body}
      </div>
    );
  }
  return (
    <label className="cube-pull-row">
      <input
        type="checkbox"
        className="cube-pull-check"
        checked={checked}
        onChange={() => onToggle(row.key)}
      />
      {body}
    </label>
  );
}

function CubePullGroupBlock({
  group,
  ticked,
  onToggle,
}: {
  group: CubePullGroup;
  ticked: Set<string>;
  onToggle: (key: string) => void;
}) {
  const pullable = isPullableGroupKind(group.kind);
  return (
    <div className="cube-pull-group">
      <div className="cube-pull-group-head">
        {group.color && (
          <span
            className="cube-pull-group-pip"
            style={{ background: group.color }}
            aria-hidden="true"
          />
        )}
        <span className="cube-pull-group-name">{group.label}</span>
        <span className="cube-pull-group-count">
          {group.rows.length} {group.rows.length === 1 ? 'card' : 'cards'}
        </span>
      </div>
      {group.kind === 'out' && <p className="cube-pull-group-hint">{outHint(group.binderNames)}</p>}
      {group.kind === 'binder' ? (
        pagesOf(group.rows).map((page) => (
          <div key={page.pageNum} className="cube-pull-page">
            <div className="cube-pull-page-head">Page {page.pageNum}</div>
            <div className="cube-pull-rows">
              {page.rows.map((row) => (
                <CubePullRowItem
                  key={row.key}
                  row={row}
                  pullable={pullable}
                  checked={ticked.has(row.key)}
                  onToggle={onToggle}
                  showSlot
                />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="cube-pull-rows">
          {group.rows.map((row) => (
            <CubePullRowItem
              key={row.key}
              row={row}
              pullable={pullable}
              checked={ticked.has(row.key)}
              onToggle={onToggle}
              showSlot={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Pull list by binder" tab body for a physical cube: where each reserved
 * copy sits, sorted binder by binder, page by page (see
 * `lib/cube/pull-list.ts`, which this feeds with the exact hooks/options
 * `BinderPage.tsx` uses, so a row can never disagree with what the Binders
 * page itself would show for that binder).
 */
export function CubePullList({ cube }: { cube: SavedCube }) {
  const awaitingFirstPull = useAwaitingFirstPull();
  const hydrating = useCollectionStore((s) => s.hydrating);
  // Retry bumps this to force the guarded memo below to run again — this tab
  // reads only local state (collection/binders/allocations), so a sync error
  // ANYWHERE else in the app (a deck push, an unrelated pull) must never
  // replace a perfectly good list with an error here. The only failure this
  // tab can have is its own placement computation throwing.
  const [buildAttempt, setBuildAttempt] = useState(0);

  const [ticked, setTicked] = useState<Set<string>>(() => loadTicks(cube.id));
  // Reload ticks when the viewed cube changes — the render-phase prev-state
  // pattern (React's own recipe for "reset derived state when a prop
  // changes"), not an effect: `set-state-in-effect` is a lint error here.
  const [ticksCubeId, setTicksCubeId] = useState(cube.id);
  if (cube.id !== ticksCubeId) {
    setTicksCubeId(cube.id);
    setTicked(loadTicks(cube.id));
  }
  const toggleTick = (key: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      safeLocalStorage.setItem(ticksKey(cube.id), JSON.stringify([...next]));
      return next;
    });
  };
  const clearTicks = () => {
    setTicked(new Set());
    safeLocalStorage.removeItem(ticksKey(cube.id));
  };

  // Same decoration pipeline as BinderPage.tsx, in the same order — a binder
  // sorting/routing by tag, Secret Lair drop, or per-printing release date
  // needs the same card fields those hooks stamp on, or its rows here would
  // disagree with what the Binders page shows for it.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();

  // `attempt` is read into the returned value purely so it's a REAL
  // dependency — "Retry" bumps `buildAttempt`, and this memo has to
  // actually depend on it to run again, not just list it for eslint's sake.
  const { groups, buildError } = useMemo(() => {
    try {
      return {
        groups: buildCubePullList(cube.picks, cards, binders, { allocatedCopyIds, setMap }),
        buildError: false,
        attempt: buildAttempt,
      };
    } catch {
      return { groups: [] as CubePullGroup[], buildError: true, attempt: buildAttempt };
    }
  }, [cube.picks, cards, binders, allocatedCopyIds, setMap, buildAttempt]);

  if (hydrating || awaitingFirstPull) {
    return (
      <div className="cube-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="cube-loading-text">Locating your reserved copies…</span>
      </div>
    );
  }
  if (buildError) {
    return (
      <CubeErrorBlock
        error="Couldn't build the pull list. Try again."
        onRetry={() => setBuildAttempt((n) => n + 1)}
      />
    );
  }

  const locatedCount = groups
    .filter((g) => isPullableGroupKind(g.kind))
    .reduce((n, g) => n + g.rows.length, 0);
  const outCount = groups.find((g) => g.kind === 'out')?.rows.length ?? 0;
  const unreservedCount = groups.find((g) => g.kind === 'unreserved')?.rows.length ?? 0;
  const summary = [
    `${locatedCount.toLocaleString()} of ${cube.picks.length.toLocaleString()} located`,
  ];
  if (outCount > 0) summary.push(`${outCount.toLocaleString()} already out`);
  if (unreservedCount > 0) summary.push(`${unreservedCount.toLocaleString()} not reserved`);

  return (
    <div className="cube-pull-list">
      <div className="cube-pull-summary">
        <p className="cube-pull-summary-note" role="status" aria-live="polite">
          {summary.join(' · ')}
        </p>
        <div className="cube-pull-actions">
          {ticked.size > 0 && (
            <Button variant="link" onClick={clearTicks}>
              Clear ticks
            </Button>
          )}
          <Button
            placement="row"
            icon={<Printer width={14} height={14} strokeWidth={1.8} />}
            onClick={() => window.print()}
          >
            Print
          </Button>
        </div>
      </div>
      <div className="cube-pull-groups">
        {groups.map((group) => (
          <CubePullGroupBlock key={group.key} group={group} ticked={ticked} onToggle={toggleTick} />
        ))}
      </div>
      {/* Print-only checklist — invisible on screen (styles/print.css's
          `.print-list`, the same convention BinderPage's binder checklist
          and DeckDisplay's deck list use). One section per group; a binder
          row's page/slot stands in for the printing column those use. */}
      <div className="print-list" aria-hidden>
        <h1 className="print-list-title">{cube.name} · Pull list</h1>
        {groups.map((group) => {
          const pullable = isPullableGroupKind(group.kind);
          return (
            <section key={group.key} className="print-list-section">
              <h2 className="print-list-section-title">{group.label}</h2>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.key}>
                    {pullable && <span className="print-list-box" aria-hidden="true" />}
                    <span className="print-list-name">{row.name}</span>
                    <span className="print-list-printing">
                      {row.pageNum !== undefined
                        ? formatLocation(
                            { binderName: group.label, pageNum: row.pageNum, slot: row.slotNum },
                            { binder: false }
                          )
                        : (row.reason && REASON_TEXT[row.reason]) || ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

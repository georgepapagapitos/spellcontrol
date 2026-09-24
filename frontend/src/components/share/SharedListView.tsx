import { useMemo, useState } from 'react';
import type { PublicList, PublicListEntry } from '../../lib/shared-types';
import { normalizeForSearch } from '../../lib/normalize-search';
import { formatMoney } from '../../lib/format-money';
import { formatIdentity } from '../../lib/display-name';
import { SearchPill } from '../SearchPill';
import { SortDirArrow } from '../SortDirArrow';
import { SharedEmptyState } from './SharedEmptyState';
import { nameMatchesNormalized, printedName } from '@spellcontrol/binder-routing';
import { CardName } from '@/components/shared/CardName';

interface Props {
  data: PublicList;
}

type ListSortKey = 'name' | 'quantity' | 'targetPrice' | 'set';
type SortDir = 'asc' | 'desc';

export function SharedListView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nq = normalizeForSearch(search);
    if (!nq) return data.entries;
    return data.entries.filter(
      (e) => nameMatchesNormalized(e, nq) || (e.note ?? '').toLowerCase().includes(q)
    );
  }, [data.entries, search]);

  const sorted = useMemo(() => {
    const sign = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let diff = 0;
      switch (sort) {
        case 'name':
          diff = printedName(a).localeCompare(printedName(b));
          break;
        case 'quantity':
          diff = a.quantity - b.quantity;
          break;
        case 'targetPrice':
          diff = (a.targetPrice ?? 0) - (b.targetPrice ?? 0);
          break;
        case 'set':
          diff = a.setCode.localeCompare(b.setCode);
          break;
      }
      if (diff === 0) diff = printedName(a).localeCompare(printedName(b));
      return diff * sign;
    });
  }, [filtered, sort, dir]);

  const totalQty = data.entries.reduce((s, e) => s + e.quantity, 0);

  const toggleSort = (key: ListSortKey) => {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('asc');
    }
  };

  const sortIndicator = (key: ListSortKey) => (sort === key ? <SortDirArrow dir={dir} /> : null);

  const owner = formatIdentity({
    username: data.ownerUsername,
    displayName: data.ownerDisplayName,
  });

  return (
    <div className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">
          Shared by {owner.primary}
          {owner.secondary && <span className="shared-view-owner-handle">{owner.secondary}</span>}
        </p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {totalQty.toLocaleString()} {totalQty === 1 ? 'card' : 'cards'} · {data.entries.length}{' '}
          {data.entries.length === 1 ? 'entry' : 'entries'}
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search entries or notes…"
          ariaLabel="Search entries"
          className="shared-toolbar-search"
        />
      </div>

      {sorted.length === 0 ? (
        <SharedEmptyState
          empty={data.entries.length === 0}
          emptyTagline="This list is empty."
          emptyHint="The owner hasn't added any entries to it yet."
          filteredTagline="No entries match your search."
          onClearSearch={search ? () => setSearch('') : undefined}
        />
      ) : (
        <div className="shared-table-scroll">
          <table className="shared-list-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className="shared-list-sort-btn"
                    onClick={() => toggleSort('quantity')}
                  >
                    Qty{sortIndicator('quantity')}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="shared-list-sort-btn"
                    onClick={() => toggleSort('name')}
                  >
                    Name{sortIndicator('name')}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="shared-list-sort-btn"
                    onClick={() => toggleSort('set')}
                  >
                    Set{sortIndicator('set')}
                  </button>
                </th>
                <th>Finish</th>
                <th>
                  <button
                    type="button"
                    className="shared-list-sort-btn"
                    onClick={() => toggleSort('targetPrice')}
                  >
                    Target{sortIndicator('targetPrice')}
                  </button>
                </th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, idx) => (
                <ListRow key={`${e.scryfallId}-${idx}`} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListRow({ entry: e }: { entry: PublicListEntry }) {
  return (
    <tr>
      <td data-label="Qty">{e.quantity}</td>
      <td data-label="Name">
        <CardName card={e} />
      </td>
      <td data-label="Set">
        {e.setCode.toUpperCase()} {e.collectorNumber}
      </td>
      <td data-label="Finish">{e.finish}</td>
      {/* Target prices render in the currency the OWNER entered them in
          (entry.currency; absent = pre-EUR entry = USD) — never relabeled to
          the viewer's display currency. */}
      <td data-label="Target">
        {e.targetPrice != null ? formatMoney(e.targetPrice, { currency: e.currency ?? 'USD' }) : ''}
      </td>
      <td data-label="Note">{e.note ?? ''}</td>
    </tr>
  );
}

import { useMemo, useState } from 'react';
import type { PublicList, PublicListEntry } from '../../lib/shared-types';
import { SearchPill } from '../SearchPill';

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
    if (!q) return data.entries;
    return data.entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.note ?? '').toLowerCase().includes(q)
    );
  }, [data.entries, search]);

  const sorted = useMemo(() => {
    const sign = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let diff = 0;
      switch (sort) {
        case 'name':
          diff = a.name.localeCompare(b.name);
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
      if (diff === 0) diff = a.name.localeCompare(b.name);
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

  const sortIndicator = (key: ListSortKey) => (sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
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
        <p className="shared-empty">
          {data.entries.length === 0 ? 'This list is empty.' : 'No entries match your search.'}
        </p>
      ) : (
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
      )}
    </main>
  );
}

function ListRow({ entry: e }: { entry: PublicListEntry }) {
  return (
    <tr>
      <td>{e.quantity}</td>
      <td>{e.name}</td>
      <td>
        {e.setCode.toUpperCase()} {e.collectorNumber}
      </td>
      <td>{e.finish}</td>
      <td>{e.targetPrice != null ? `$${e.targetPrice.toFixed(2)}` : ''}</td>
      <td>{e.note ?? ''}</td>
    </tr>
  );
}

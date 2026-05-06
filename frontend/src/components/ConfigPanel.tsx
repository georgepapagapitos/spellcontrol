import { useCollectionStore } from '../store/collection';
import type { PocketSize } from '../types';

export function ConfigPanel() {
  const {
    globalPocketSize,
    search,
    setGlobalPocketSize,
    setSearch,
  } = useCollectionStore();

  return (
    <div className="panel">
      <div className="field">
        <label>Default pocket layout</label>
        <select
          value={globalPocketSize}
          onChange={(e) => setGlobalPocketSize(parseInt(e.target.value) as PocketSize)}
        >
          <option value={9}>9-pocket pages</option>
          <option value={18}>18-pocket pages</option>
          <option value={4}>4-pocket pages</option>
        </select>
      </div>

      <div className="field">
        <label>Search cards</label>
        <input
          type="text"
          placeholder="Filter by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </div>
  );
}

import { useState } from 'react';

interface Props {
  onCreate(name: string): void;
  onClose(): void;
}

const PRESETS = ['Treasure', 'Clue', 'Food', 'Soldier 1/1', 'Zombie 2/2', 'Spirit 1/1 flying'];

export function TokenCreator({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  return (
    <div className="playtest-modal" role="dialog" aria-label="Create token">
      <div className="playtest-modal__backdrop" onClick={onClose} />
      <div className="playtest-modal__panel playtest-modal__panel--narrow">
        <div className="playtest-modal__header">
          <h2>Create token</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Treasure)"
          className="playtest-modal__search"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              onCreate(name.trim());
              setName('');
            }
          }}
          autoFocus
        />
        <div className="playtest-token__presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => onCreate(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="playtest-modal__footer">
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onCreate(name.trim());
              setName('');
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

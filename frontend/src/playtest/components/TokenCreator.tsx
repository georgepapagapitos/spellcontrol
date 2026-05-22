import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';

interface Props {
  onCreate(name: string): void;
  onClose(): void;
}

const PRESETS = ['Treasure', 'Clue', 'Food', 'Soldier 1/1', 'Zombie 2/2', 'Spirit 1/1 flying'];

export function TokenCreator({ onCreate, onClose }: Props) {
  useLockBodyScroll();
  useEscapeKey(onClose);
  const [name, setName] = useState('');
  return (
    <div className="card-picker-root" role="presentation" onClick={onClose}>
      <div className="card-picker-backdrop" />
      <div
        className="card-picker-sheet playtest-token-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Create token"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Create token</h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token name (e.g. Treasure)"
            className="card-picker-search"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                onCreate(name.trim());
                setName('');
              }
            }}
            autoFocus
          />
        </div>
        <div className="playtest-token-presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => onCreate(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="card-picker-footer">
          <button
            type="button"
            className="btn btn-primary"
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

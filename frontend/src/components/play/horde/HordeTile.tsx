import { Check } from 'lucide-react';
import { ColorPip } from '../../shared/ManaSymbol';
import type { HordeCatalogEntry } from '@/lib/horde';
import './horde-setup.css';

interface Props {
  horde: HordeCatalogEntry;
  selected: boolean;
  onSelect(): void;
}

/**
 * One horde in the setup screen's picker grid — the Discover deck tile's
 * visual vocabulary (art banner, color pips, badge, name) reused for a
 * catalog entry that isn't a deck: no owner, no stats, just what you're
 * fighting. See STYLE_GUIDE "Discover deck tiles".
 */
export function HordeTile({ horde, selected, onSelect }: Props) {
  return (
    <li className="horde-tile-item">
      <button
        type="button"
        className={`horde-tile${selected ? ' is-selected' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="horde-tile-banner">
          <img src={horde.tileArt} alt="" aria-hidden="true" loading="lazy" />
          {selected && (
            <span className="horde-tile-check" aria-hidden="true">
              <Check width={14} height={14} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="horde-tile-body">
          <span className="horde-tile-name">{horde.name}</span>
          <span className="horde-tile-meta">
            <span className="horde-tile-pips" aria-hidden="true">
              {horde.themeColors.map((c) => (
                <ColorPip key={c} color={c} />
              ))}
            </span>
            <span className="deck-format-badge">{horde.badge}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

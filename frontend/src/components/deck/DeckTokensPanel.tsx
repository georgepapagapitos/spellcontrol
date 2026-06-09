import { type JSX, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DeckToken } from '@/lib/deck-tokens';
import './DeckTokensPanel.css';

const COLLAPSE_KEY = 'spellcontrol-deck-tokens-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

const tokenId = (t: DeckToken): string => `${t.name} ${t.typeLine ?? ''}`;

/**
 * A deck's token-prep checklist for the Stats tab.
 *
 * Progressive disclosure so it stays light on every viewport: a collapsible
 * panel (preference persisted) whose body is a compact wrap of "name ×N" chips
 * — N being how many deck cards make that token. Tapping a chip reveals the
 * detail (token type + the cards that produce it). Renders nothing when the
 * deck makes no tokens.
 */
export function DeckTokensPanel({ tokens }: { tokens: DeckToken[] }): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [openId, setOpenId] = useState<string | null>(null);

  if (tokens.length === 0) return null;

  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  };

  const selected = tokens.find((t) => tokenId(t) === openId) ?? null;

  return (
    <section className="deck-stats-panel deck-tokens" aria-label="Tokens this deck makes">
      <button
        type="button"
        className="deck-tokens-header"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        {collapsed ? (
          <ChevronRight size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
        <span className="deck-tokens-title">Tokens to prep</span>
        <span className="deck-tokens-count">{tokens.length}</span>
      </button>

      {!collapsed && (
        <div className="deck-tokens-body">
          <ul className="deck-tokens-chips">
            {tokens.map((t) => {
              const id = tokenId(t);
              const open = id === openId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`deck-tokens-chip${open ? ' deck-tokens-chip--open' : ''}`}
                    aria-pressed={open}
                    onClick={() => setOpenId(open ? null : id)}
                  >
                    <span className="deck-tokens-chip-name">{t.name}</span>
                    <span className="deck-tokens-chip-count">×{t.producers.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <div
              className="deck-tokens-detail"
              role="region"
              aria-label={`${selected.name} details`}
            >
              {selected.typeLine && (
                <span className="deck-tokens-detail-type">
                  {selected.typeLine.replace(/^Token\s+/i, '')}
                </span>
              )}
              <span className="deck-tokens-detail-producers">
                <span className="deck-tokens-detail-label">Made by</span>{' '}
                {selected.producers.join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

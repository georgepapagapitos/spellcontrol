import { AlertTriangle, Ban, Check, ChevronDown, Minus } from 'lucide-react';
import { useState } from 'react';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { cardFaces, legalityRows, type LegalityStatus } from '../lib/card-details';
import { ManaCost } from './ManaCost';
import { MagicText } from './deck/MagicText';
import './CardDetails.css';

/* ── Card text (oracle / flavor / P-T) ─────────────────────────────────── */

export function CardText({ card, detail }: { card: EnrichedCard; detail: ScryfallCard | null }) {
  const faces = cardFaces(card, detail);
  if (faces.length === 0) return null;
  const multi = faces.length > 1;

  return (
    <div className="card-text">
      {faces.map((f, i) => (
        <div key={i} className="card-text-face">
          {multi && (f.name || f.typeLine) && (
            <div className="card-text-face-head">
              {f.name && <span className="card-text-face-name">{f.name}</span>}
              {f.manaCost && <ManaCost cost={f.manaCost} className="card-text-face-mana" />}
              {f.typeLine && <span className="card-text-face-type">{f.typeLine}</span>}
            </div>
          )}
          {f.oracleText && <MagicText text={f.oracleText} className="card-text-oracle" />}
          {f.flavorText && <p className="card-text-flavor">{f.flavorText}</p>}
          {(f.pt || f.loyalty) && (
            <div
              className="card-text-stat"
              aria-label={f.pt ? `Power/toughness ${f.pt}` : `Loyalty ${f.loyalty}`}
            >
              {f.pt ?? `Loyalty ${f.loyalty}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Format legalities (disclosure) ────────────────────────────────────── */

function StatusIcon({ status }: { status: LegalityStatus }) {
  const props = { width: 13, height: 13, strokeWidth: 2.4, 'aria-hidden': true } as const;
  if (status === 'legal') return <Check {...props} />;
  if (status === 'banned') return <Ban {...props} />;
  if (status === 'restricted') return <AlertTriangle {...props} />;
  return <Minus {...props} />;
}

export function CardLegalities({ legalities }: { legalities: Record<string, string> | undefined }) {
  const [open, setOpen] = useState(false);
  const rows = legalityRows(legalities);
  if (rows.length === 0) return null;

  return (
    <div className="card-legalities">
      <button
        type="button"
        className="card-disc-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          width={14}
          height={14}
          strokeWidth={2.2}
          aria-hidden
          className={`card-disc-chevron${open ? ' is-open' : ''}`}
        />
        Legalities
      </button>
      {open && (
        <div className="card-legalities-grid">
          {rows.map((r) => (
            <div
              key={r.key}
              className={`card-legality card-legality--${r.status}`}
              title={`${r.label}: ${r.statusLabel}`}
            >
              <StatusIcon status={r.status} />
              <span className="card-legality-fmt">{r.label}</span>
              <span className="sr-only">{r.statusLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

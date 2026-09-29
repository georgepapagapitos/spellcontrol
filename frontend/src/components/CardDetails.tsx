import { AlertTriangle, Ban, Check, ChevronDown, Minus } from 'lucide-react';
import { useState } from 'react';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { cardFaces, legalityRows, type LegalityStatus } from '@/lib/cards/card-details';
import { ManaCost } from './ManaCost';
import { useRulesText } from '@/lib/cards/keyword-glossary';
import { RulesTextLine } from './RulesText';
import './CardDetails.css';

/* ── Card text (oracle / flavor / P-T) ─────────────────────────────────── */

/** Rules text split into per-ability paragraphs. */
function OracleText({ text, names }: { text: string; names: readonly string[] }) {
  const lines = useRulesText(text, names);
  return (
    <div className="card-text-oracle">
      {lines.map((segments, i) => (
        <p key={i} className="card-text-line">
          <RulesTextLine segments={segments} />
        </p>
      ))}
    </div>
  );
}

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
          {f.oracleText && <OracleText text={f.oracleText} names={[card.name]} />}
          {f.flavorText && <p className="card-text-flavor">{f.flavorText}</p>}
          {/* Single-face P/T is shown at the type line; only DFC per-face stats render here. */}
          {multi && (f.pt || f.loyalty) && (
            <div
              className="card-text-stat"
              aria-label={f.pt ? `Power/toughness ${f.pt}` : `Loyalty ${f.loyalty}`}
              role="img"
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

export function CardLegalities({
  legalities,
  defaultOpen = false,
}: {
  legalities: Record<string, string> | undefined;
  /** Start expanded — the card preview shows everything it has room for. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
          strokeWidth={1.8}
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
              {/* The word, not just the icon's colour: status is never colour-only. */}
              <span className="card-legality-status">{r.statusLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

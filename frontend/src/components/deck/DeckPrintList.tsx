import { CardName } from '@/components/shared/CardName';
import type { Row, TypedGroup } from './deck-display-rows';

function PrintRow({ row }: { row: Row }) {
  return (
    <li>
      <span className="print-list-qty">{row.qty}</span>
      <span className="print-list-name">
        <CardName card={row} oracleFirst />
      </span>
      <span className="print-list-printing">
        {row.setCode.toUpperCase()} {row.collectorNumber}
      </span>
    </li>
  );
}

/**
 * Print-only checklist (name/qty/set-cn), grouped like the list view.
 * Invisible on screen (styles/print.css's `.print-list`); DeckExportDialog's
 * "Print list" action closes itself and calls window.print(), which the print
 * stylesheet then renders as this instead of the normal interactive view.
 */
export function DeckPrintList({
  title,
  groups,
  sideboardGroups,
}: {
  title: string;
  groups: TypedGroup[];
  sideboardGroups: TypedGroup[];
}) {
  return (
    <div className="print-list" aria-hidden>
      <h1 className="print-list-title">{title}</h1>
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <section key={g.title} className="print-list-section">
            <h2 className="print-list-section-title">{g.title}</h2>
            <ul>
              {g.rows.map((row) => (
                <PrintRow key={row.slotIds[0] ?? row.name} row={row} />
              ))}
            </ul>
          </section>
        ))}
      {sideboardGroups.some((g) => g.rows.length > 0) && (
        <section className="print-list-section">
          <h2 className="print-list-section-title">Sideboard</h2>
          <ul>
            {sideboardGroups
              .flatMap((g) => g.rows)
              .map((row) => (
                <PrintRow key={row.slotIds[0] ?? row.name} row={row} />
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import { useCallback, useId, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Hand, Package, Plus, Wand2 } from 'lucide-react';
// New-deck-only stylesheets ship with this chunk, not the boot payload (E265).
import '@/styles/deck-builder-import-dialog.css';
import './DeckNewPage.css';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { ProductSearchDialog } from '../components/ProductSearchDialog';
import { BackLink } from '../components/BackLink';
import { useDecksStore } from '../store/decks';
import { createEmptyDeck } from '../lib/create-empty-deck';
import { parseDeckFormat } from '../lib/deck-format-param';
import type { DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Button } from '@/components/shared/Button';
import type { GenerateRouteState } from './DeckGeneratePage';

type DoorProps = {
  icon: ReactNode;
  title: string;
  description: string;
  /** The one full-width door, with a visible call to action. */
  feature?: string;
  /** An open slot, like BinderStartChooser's Blank tile: the start with nothing preset. */
  dashed?: boolean;
} & ({ to: string; onClick?: never } | { onClick: () => void; to?: never });

/**
 * One way to start. A link when it goes to another page, a button when it
 * acts here (creates a deck, opens a dialog). Its accessible name is the
 * title alone, with the description attached as a description, so a screen
 * reader hears "Brew it slot by slot" and not the whole paragraph.
 */
function Door({ icon, title, description, feature, dashed, to, onClick }: DoorProps) {
  const id = useId();
  const cls = `deck-new-door${feature ? ' is-feature' : ''}${dashed ? ' is-dashed' : ''}`;
  const body = (
    <>
      <span className="deck-new-door-glyph" aria-hidden>
        {icon}
      </span>
      <span className="deck-new-door-text">
        <span id={`${id}-t`} className="deck-new-door-title">
          {title}
        </span>
        <span id={`${id}-d`} className="deck-new-door-desc">
          {description}
        </span>
      </span>
      {feature ? (
        <span className="deck-new-door-cta" aria-hidden>
          <span className="deck-new-door-cta-label">{feature}</span>
          <ArrowRight width={14} height={14} strokeWidth={1.8} />
        </span>
      ) : (
        <ArrowRight className="deck-new-door-go" width={16} height={16} aria-hidden />
      )}
    </>
  );
  const a11y = { 'aria-labelledby': `${id}-t`, 'aria-describedby': `${id}-d` };
  return to !== undefined ? (
    <Link to={to} className={cls} {...a11y}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick} {...a11y}>
      {body}
    </button>
  );
}

/**
 * `/decks/new` — how do you want to start? Format first, because it decides
 * which starts apply, then one door per start: generate, brew, an empty deck,
 * an import, a product. None of them asks for a commander here; the generator
 * (`/decks/new/generate`) and Brew each open on their own commander search,
 * and an empty deck chooses its commander later in the editor.
 */
export function DeckNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const createDeck = useDecksStore((s) => s.createDeck);

  const format: DeckFormat = parseDeckFormat(searchParams.get('format')) ?? 'commander';
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  const isPdh = format === 'paupercommander';

  const [showImport, setShowImport] = useState(false);
  const [showProduct, setShowProduct] = useState(false);
  // Below 600px the format grid claims most of the first screen before the
  // doors; collapse it to the active pill + a disclosure.
  const [formatExpanded, setFormatExpanded] = useState(false);
  // Radios group by shared `name`: scope the group to this page instance.
  const formatGroup = useId();

  const applyFormat = useCallback(
    (fmt: DeckFormat) => {
      setFormatExpanded(false);
      // Replace, not push: Back leaves the page rather than stepping through
      // every pill, and a return from the generator lands on the same format.
      setSearchParams({ format: fmt }, { replace: true });
    },
    [setSearchParams]
  );

  const handleEmptyDeck = useCallback(() => {
    navigate(`/decks/${createEmptyDeck(format, createDeck)}`);
  }, [navigate, format, createDeck]);

  // Generation intent that arrived here before the split (a history entry, a
  // stale link, an old in-app caller): forward it to the generator intact
  // rather than drop a regenerate or a combo seed on the floor.
  const carried = location.state as GenerateRouteState | null;
  if (carried?.prefill || carried?.commanderSource) {
    const fmt = carried.prefill?.format ?? format;
    return <Navigate to={`/decks/new/generate?format=${fmt}`} replace state={carried} />;
  }

  return (
    <div className="deck-builder-page deck-new-page">
      <BackLink to="/decks" label="All decks" />
      <header className="deck-builder-header">
        <h1>New deck</h1>
        <p className="deck-builder-subtitle">You can change the format later.</p>
      </header>

      {showImport && <ImportDeckDialog onClose={() => setShowImport(false)} format={format} />}
      {showProduct && <ProductSearchDialog onClose={() => setShowProduct(false)} />}

      <section
        className={`deck-builder-section deck-new-format-section${
          formatExpanded ? ' is-expanded' : ''
        }`}
      >
        <h2 className="deck-builder-section-title">Format</h2>
        <div className="deck-new-format-summary">
          <span className="deck-new-format-summary-active">{formatConfig.label}</span>
          <Button variant="link" onClick={() => setFormatExpanded(true)}>
            Change format
          </Button>
        </div>
        <fieldset className="format-pill-row" aria-label="Deck format">
          {(Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[]).map((fmt) => {
            const active = format === fmt;
            return (
              <label key={fmt} className={`format-pill${active ? ' active' : ''}`}>
                <input
                  type="radio"
                  name={formatGroup}
                  value={fmt}
                  checked={active}
                  onChange={() => applyFormat(fmt)}
                />
                <span>{DECK_FORMAT_CONFIGS[fmt].label}</span>
              </label>
            );
          })}
        </fieldset>
        <p className="format-pill-hint">{formatConfig.description}</p>
      </section>

      <div className="deck-new-doors">
        {formatConfig.hasCommander && (
          <Door
            to={`/decks/new/generate?format=${format}`}
            feature="Find a commander"
            icon={<Wand2 width={20} height={20} strokeWidth={1.8} />}
            title="Generate a deck"
            description={
              isPdh
                ? 'Find a commander, then get a full 100 chosen by card function to tune.'
                : 'Find a commander, then get a full 100 drafted from EDHREC data to tune.'
            }
          />
        )}
        {/* Brew walks the EDHREC-driven flow, and EDHREC has no PDH data. */}
        {formatConfig.hasCommander && !isPdh && (
          <Door
            to="/decks/new/brew"
            icon={<Hand width={20} height={20} strokeWidth={1.8} />}
            title="Brew it slot by slot"
            description="Build one slot at a time from a hand of candidates you add or pass."
          />
        )}
        <Door
          onClick={handleEmptyDeck}
          dashed
          icon={<Plus width={20} height={20} strokeWidth={1.8} />}
          title={formatConfig.hasCommander ? 'Empty deck' : `Empty ${formatConfig.label} deck`}
          description={
            formatConfig.hasCommander
              ? 'Add cards now. Choose the commander and name later.'
              : 'Open the editor and add cards.'
          }
        />
        <Door
          onClick={() => setShowImport(true)}
          icon={<Download width={20} height={20} strokeWidth={1.8} />}
          title="Import a list"
          description="Paste a decklist or a deck link."
        />
        {/* Products are Commander precons and boxed decks, and the dialog
            builds each in the product's own format, so it's offered only
            where that matches the pill. */}
        {format === 'commander' && (
          <Door
            onClick={() => setShowProduct(true)}
            icon={<Package width={20} height={20} strokeWidth={1.8} />}
            title="Add a product"
            description="A precon or boxed deck, added as it came in the box."
          />
        )}
      </div>
      {!formatConfig.hasCommander && (
        <p className="deck-new-doors-hint">Generating and brewing need a commander format.</p>
      )}
    </div>
  );
}

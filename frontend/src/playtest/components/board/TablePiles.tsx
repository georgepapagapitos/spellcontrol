import type {
  LibraryReveal,
  PlaytestAction,
  PlaytestCard,
  PlaytestState,
  Zone,
} from '@/lib/playtest';
import { ChevronDown } from 'lucide-react';
import { ZonePile } from '../ZonePile';

interface TablePilesProps {
  /** Only the zones and the commander tax are read. */
  state: Pick<PlaytestState, 'zones' | 'commanderTax'>;
  dispatch: (action: PlaytestAction) => void;
  libraryCount: number;
  libraryReveal: LibraryReveal;
  /** Exile's face-down cards, as a set for the viewer's per-card badge. */
  faceDownExile: ReadonlySet<string>;
  taxCards: PlaytestCard[];
  isPhone: boolean;
  /** Whether the hand button's menu is the one open. */
  handMenuOpen: boolean;
  onOpenHandMenu: (x: number, y: number) => void;
  doDraw: () => void;
  openPileMenu: (zone: Zone) => (x: number, y: number) => void;
  onViewZone: (zone: Zone) => void;
  onCommanderMenu: (cardId: string, x: number, y: number) => void;
}

/** The pile row on the felt: the hand's count and menu, the library, the
 *  graveyard and — off a phone — exile and the command zone. */
export function TablePiles({
  state,
  dispatch,
  libraryCount,
  libraryReveal,
  faceDownExile,
  taxCards,
  isPhone,
  handMenuOpen,
  onOpenHandMenu,
  doDraw,
  openPileMenu,
  onViewZone,
  onCommanderMenu,
}: TablePilesProps) {
  return (
    <aside className="playtest-piles">
      {/* The hand's count and its menu, beside the library as in EDHPlay. */}
      <button
        type="button"
        className="playtest-hand-menu-btn"
        aria-haspopup="menu"
        aria-expanded={handMenuOpen}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpenHandMenu(r.right, r.top);
        }}
      >
        <ChevronDown aria-hidden width={14} height={14} strokeWidth={1.8} />
        Hand ({state.zones.hand.length})
      </button>
      <ZonePile
        zone="library"
        label="Library"
        cards={state.zones.library}
        // The library's click draws. It is the one pile with an action taken
        // often enough to own the click outright, which is what frees the
        // menu to hold everything else (and what EDHPlay does, so the habit
        // players arrive with is the right one here).
        click={{ label: 'Draw a card', onClick: doDraw, disabled: libraryCount === 0 }}
        onMenu={openPileMenu('library')}
        revealTop={libraryReveal === 'top' || libraryReveal === 'top-me'}
      />
      <ZonePile
        zone="graveyard"
        label="Graveyard"
        cards={state.zones.graveyard}
        click={{ label: 'View the graveyard', onClick: () => onViewZone('graveyard') }}
        onMenu={openPileMenu('graveyard')}
      />
      {!isPhone && (
        <>
          <ZonePile
            zone="exile"
            label="Exile"
            cards={state.zones.exile}
            hiddenIds={faceDownExile}
            click={{ label: 'View exile', onClick: () => onViewZone('exile') }}
            onMenu={openPileMenu('exile')}
          />
          <ZonePile
            zone="command"
            label="Command"
            cards={state.zones.command}
            commanderTax={state.commanderTax}
            taxCards={taxCards}
            onAdjustTax={(cardId, delta) =>
              dispatch({ type: 'ADJUST_COMMANDER_TAX', cardId, delta })
            }
            click={{
              label: 'View the command zone',
              onClick: () => onViewZone('command'),
            }}
            onMenu={openPileMenu('command')}
            // A click or right-click on one commander is that card's menu,
            // as it is in EDHPlay, and its Move to ▸ Battlefield casts it: a
            // click that cast straight away put a commander on the table
            // every time someone only meant to look at it. Dragging it to
            // the battlefield casts it too (the reducer bumps its tax).
            // Anywhere else on the tile is still the zone's menu.
            onCardMenu={(card, x, y) => onCommanderMenu(card.id, x, y)}
          />
        </>
      )}
    </aside>
  );
}

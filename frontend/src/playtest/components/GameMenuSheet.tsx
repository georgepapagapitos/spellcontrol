import { X, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import './GameMenuSheet.css';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';

/** One row of the drawer: an icon, what it does, and how it stands. */
export interface GameMenuItem {
  label: string;
  icon: LucideIcon;
  onClick(): void;
  /** Short right-aligned state: "New", "On", a count. */
  note?: string;
  /** Ends a game or gives up a seat: reads in the error colour. */
  danger?: boolean;
}

/** A named run of rows. A category word, so the stylesheet uppercases it. */
export interface GameMenuSection {
  title: string;
  items: GameMenuItem[];
}

interface Props {
  sections: GameMenuSection[];
  /** The group that stays pinned to the drawer's foot, away from the rest. */
  footer: GameMenuSection;
  onClose(): void;
}

/**
 * The battlefield's game menu, as a drawer rather than a kebab popover.
 *
 * The board's secondary actions had grown past what a floating list can carry:
 * nine or ten one-line entries in reading order, with "Reset" sitting a pixel
 * above "Table settings". A drawer gives them category headings, icons, and a
 * foot the game-ending actions can live in, so a mis-tap costs a setting
 * rather than a table.
 *
 * Docked to the right edge under the hamburger it opens from, full height, on
 * every tier: a menu you can scan is worth more than the bottom-sheet
 * convention here, and the board underneath has no scroll to lose.
 */
export function GameMenuSheet({ sections, footer, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'playtest-game-menu-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const titleId = useId();

  // Close first, then act: a row that opens another sheet (Stats, Table
  // settings) gets it stacked over a drawer that is already sliding away.
  const run = (item: GameMenuItem) => {
    beginClose();
    item.onClick();
  };

  return (
    <div className="playtest-game-menu-root" role="presentation">
      <div
        className={`playtest-game-menu-scrim${isClosing ? ' is-closing' : ''}`}
        role="presentation"
        onClick={() => beginClose()}
      />
      <div
        className={`playtest-game-menu${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onAnimationEnd={onAnimationEnd}
      >
        <header className="playtest-game-menu__head">
          <h2 id={titleId} className="playtest-game-menu__title">
            Game menu
          </h2>
          <button
            type="button"
            className="playtest-game-menu__close"
            aria-label="Close the game menu"
            onClick={() => beginClose()}
          >
            <X width={18} height={18} strokeWidth={1.8} aria-hidden />
          </button>
        </header>

        <div className="playtest-game-menu__body">
          {sections.map((section) => (
            <MenuGroup key={section.title} section={section} onRun={run} />
          ))}
        </div>

        <MenuGroup section={footer} onRun={run} className="playtest-game-menu__end" />
      </div>
    </div>
  );
}

function MenuGroup({
  section,
  onRun,
  className,
}: {
  section: GameMenuSection;
  onRun(item: GameMenuItem): void;
  className?: string;
}) {
  const labelId = useId();
  // A group whose rows are all conditional (the layout toggle, the online
  // ones) collapses rather than leaving a heading over nothing.
  if (section.items.length === 0) return null;
  return (
    <section
      className={`playtest-game-menu__group${className ? ` ${className}` : ''}`}
      aria-labelledby={labelId}
    >
      <h3 id={labelId} className="playtest-game-menu__group-title">
        {section.title}
      </h3>
      {section.items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            className={`playtest-game-menu__item${item.danger ? ' is-danger' : ''}`}
            onClick={() => onRun(item)}
          >
            <Icon
              className="playtest-game-menu__item-icon"
              width={16}
              height={16}
              strokeWidth={1.8}
              aria-hidden
            />
            <span className="playtest-game-menu__item-label">{item.label}</span>
            {item.note && <span className="playtest-game-menu__item-note">{item.note}</span>}
          </button>
        );
      })}
    </section>
  );
}

import type { PocketSize, Volume } from '../types';
import { cardsNeedVolumes } from './binder-volumes';

/** Page-filling modes as the closed Pages summary names them. The editor's
 *  options answer "When a section ends", so they read as actions ("Start a
 *  new page"); the summary stands alone, so it states the result. */
export const PACK_LABEL: Record<string, string> = {
  false: 'New page per section',
  true: 'Keep sections whole',
  continuous: 'Fill every pocket',
};

/** "Leave room" (`BinderDef.sparePockets`) as the editor offers it. */
export type LeaveRoom = 'none' | 'half' | 'full';

/** Pockets a "Leave room" choice reserves at a pocket size. Half a page
 *  rounds up, so it is never less than half. */
export function leaveRoomPockets(room: LeaveRoom, pocketSize: PocketSize): number {
  if (room === 'none') return 0;
  return room === 'full' ? pocketSize : Math.ceil(pocketSize / 2);
}

/** The choice a stored pocket count reads as, so the same room survives a
 *  pocket-size change. */
export function leaveRoomOf(sparePockets: number | undefined, pocketSize: PocketSize): LeaveRoom {
  if (!sparePockets || sparePockets <= 0) return 'none';
  return sparePockets >= pocketSize ? 'full' : 'half';
}

/**
 * The Pages disclosure's one-line summary (`BinderEditor`'s "Pages" row).
 * Leads with capacity, in plain words: capacity is what a binder is sold by,
 * so it is the fact worth reading first, and "No size limit" reads as a
 * feature, not a warning ("no limit" alone read like an error state). An
 * over-full draft says so next, in the volumes vocabulary. Layout facts
 * follow, and every setting that isn't its default is named, so a closed
 * row never hides one (§ Config surfaces, Disclosure).
 */
export function formatPagesSummary({
  pocketSize,
  doubleSided,
  fixedCapacity,
  packSections,
  sparePockets = 0,
  breakField = null,
  volumes,
}: {
  pocketSize: PocketSize;
  doubleSided: boolean;
  fixedCapacity: number | null;
  packSections: boolean | 'continuous';
  /** Room the engine will actually leave (0 while pages are shared). */
  sparePockets?: number;
  /** The deepest field that also starts a page ("Mana value"), when the
   *  page breaks go deeper than the section headers. */
  breakField?: string | null;
  /**
   * `volumesFor(draftPreview)` (E494). When the draft outgrows its own
   * capacity the closed summary says so up front, instead of staying silent
   * until the disclosure is opened. `null` or one volume (fits) adds nothing.
   */
  volumes?: Volume[] | null;
}): string {
  const capacity =
    fixedCapacity === null
      ? 'No size limit'
      : capacityPhrase(fixedCapacity, pocketSize, doubleSided);
  const overCapacity =
    fixedCapacity !== null && volumes && volumes.length > 1
      ? cardsNeedVolumes(volumes, fixedCapacity)
      : null;

  return [
    capacity,
    overCapacity,
    `${pocketSize}-pocket`,
    doubleSided ? 'both sides' : 'one side',
    PACK_LABEL[String(packSections)],
    roomPhrase(sparePockets, pocketSize),
    breakField ? `new page per ${breakField.toLowerCase()} too` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function roomPhrase(sparePockets: number, pocketSize: PocketSize): string | null {
  if (sparePockets <= 0) return null;
  if (sparePockets === pocketSize) return 'a free page after each section';
  if (sparePockets === leaveRoomPockets('half', pocketSize))
    return 'half a page free after each section';
  return `${sparePockets} free pockets after each section`;
}

/** Physical sheets a capacity fills: a double-sided binder's front/back page
 *  pair is one sheet. */
export function sheetCount(fixedCapacity: number, pocketSize: PocketSize, doubleSided: boolean) {
  const pages = Math.ceil(fixedCapacity / pocketSize);
  return doubleSided ? Math.ceil(pages / 2) : pages;
}

/** "40 sheets" / "1 sheet". */
export function sheetsPhrase(sheets: number): string {
  return `${sheets.toLocaleString()} ${sheets === 1 ? 'sheet' : 'sheets'}`;
}

/** "Holds 360 cards (20 sheets)". */
export function capacityPhrase(
  fixedCapacity: number,
  pocketSize: PocketSize,
  doubleSided: boolean
): string {
  return `Holds ${fixedCapacity.toLocaleString()} cards (${sheetsPhrase(
    sheetCount(fixedCapacity, pocketSize, doubleSided)
  )})`;
}

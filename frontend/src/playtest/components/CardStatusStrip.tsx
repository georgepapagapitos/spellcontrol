import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { displayPT } from '../lib/power-toughness';
import './CardStatusStrip.css';

interface Props {
  card: PlaytestCard;
  /** The permanent, when this card is on the battlefield. A card inspected
   *  from hand has none, and then the strip is only the commander tax. */
  bf?: BattlefieldCard;
  /** Name of the permanent this one is attached to, already resolved. */
  attachedToName?: string;
  /** Commander tax already doubled, as the card menu shows it. 0 hides it. */
  tax?: number;
}

/**
 * What is true about this card RIGHT NOW, written under its type line in the
 * inspector: tapped, face down, phased out, its counters, the body the player
 * has pumped it to, what it is attached to, what it costs to cast again.
 *
 * The printed card answers "what does this do"; a game answers "what is it
 * doing". The inspector is the one place a player reads both at once, so it
 * carries the board's own facts rather than making them go back and count
 * counters on a card they have covered with a menu.
 */
export function CardStatusStrip({ card, bf, attachedToName, tax = 0 }: Props) {
  const counters = Object.entries(bf?.counters ?? {}).filter(([, n]) => n > 0);
  const pt = bf?.pt;
  const pumped = pt && (pt.power !== 0 || pt.toughness !== 0) ? displayPT(card, bf) : null;

  const chips: Array<{ key: string; tone: 'state' | 'counter' | 'link'; text: string }> = [];
  if (bf?.tapped) chips.push({ key: 'tapped', tone: 'state', text: 'Tapped' });
  if (bf?.faceDown) chips.push({ key: 'face-down', tone: 'state', text: 'Face down' });
  if (bf?.phased) chips.push({ key: 'phased', tone: 'state', text: 'Phased out' });
  for (const [kind, n] of counters) {
    chips.push({ key: `c-${kind}`, tone: 'counter', text: `${kind} ×${n}` });
  }
  if (pumped) {
    chips.push({
      key: 'pt',
      tone: 'counter',
      text: `Now ${pumped.power}/${pumped.toughness}`,
    });
  }
  if (attachedToName) {
    chips.push({ key: 'attached', tone: 'link', text: `Attached to ${attachedToName}` });
  }
  if (tax > 0) chips.push({ key: 'tax', tone: 'link', text: `Commander tax +${tax}` });

  const stickers = bf?.stickers ?? [];
  if (chips.length === 0 && stickers.length === 0) return null;

  return (
    <div className="card-status-strip" aria-label="Board state">
      {chips.map((c) => (
        <span key={c.key} className={`card-status-chip card-status-chip--${c.tone}`}>
          {c.text}
        </span>
      ))}
      {stickers.map((text, i) => (
        <span key={`s-${i}`} className="card-status-chip card-status-chip--sticker">
          {text}
        </span>
      ))}
    </div>
  );
}

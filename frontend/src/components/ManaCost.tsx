interface Props {
  cost: string | undefined;
  className?: string;
}

/**
 * Renders a Scryfall mana-cost string ("{2}{G}{W}", "{X}{R}{R}", "{2/W}{B/G}")
 * as inline mana-font glyphs. Multi-face costs ("// "-joined) render with a
 * faint separator between the two halves.
 */
export function ManaCost({ cost, className }: Props) {
  if (!cost) return null;

  const faces = cost.split(' // ');
  return (
    <span className={`mana-cost${className ? ` ${className}` : ''}`}>
      {faces.map((face, fi) => (
        <span key={fi} className="mana-cost-face">
          {fi > 0 && <span className="mana-cost-sep">//</span>}
          {parseSymbols(face).map((sym, i) => (
            <i key={i} className={symbolToClass(sym)} title={`{${sym}}`} aria-hidden />
          ))}
        </span>
      ))}
    </span>
  );
}

function parseSymbols(face: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(face))) out.push(m[1]);
  return out;
}

/**
 * Maps Scryfall symbol payloads to mana-font classes.
 *   "W" → "ms ms-w ms-cost"
 *   "2/W" → "ms ms-2w ms-split ms-cost"
 *   "T" (tap) → "ms ms-tap ms-cost"
 *   "X" → "ms ms-x ms-cost"
 */
function symbolToClass(sym: string): string {
  const lower = sym.toLowerCase().replace(/\//g, '');
  const isHybrid = sym.includes('/');
  return `ms ms-${lower} ms-cost${isHybrid ? ' ms-split' : ''}`;
}

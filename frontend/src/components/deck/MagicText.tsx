import { Fragment } from 'react';

interface Props {
  text: string;
  className?: string;
}

/**
 * Renders a string that may contain Magic symbols in Scryfall syntax — `{T}`,
 * `{U}`, `{2/W}`, `{X}` — as inline mana-font glyphs. Mirrors the syntax that
 * Spellbook embeds in combo prereqs / steps / produces. Plain text passes
 * through unchanged.
 *
 * Kept as a tiny standalone component (rather than reusing `ManaCost`) because
 * combo text is mixed prose + symbols, whereas `ManaCost` expects a pure cost
 * string like "{2}{G}{W}".
 */
export function MagicText({ text, className }: Props) {
  const parts = parseMagicText(text);
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p.kind === 'symbol' ? (
            <i className={symbolToClass(p.value)} title={`{${p.value}}`} aria-hidden />
          ) : (
            p.value
          )}
        </Fragment>
      ))}
    </span>
  );
}

interface TextPart {
  kind: 'text' | 'symbol';
  value: string;
}

function parseMagicText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\{([^}]+)\}/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: 'text', value: text.slice(lastIdx, m.index) });
    }
    parts.push({ kind: 'symbol', value: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ kind: 'text', value: text.slice(lastIdx) });
  }
  return parts;
}

function symbolToClass(sym: string): string {
  const lower = sym.toLowerCase().replace(/\//g, '');
  const isHybrid = sym.includes('/');
  return `ms ms-${lower} ms-cost${isHybrid ? ' ms-split' : ''}`;
}

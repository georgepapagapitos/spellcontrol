import { Fragment } from 'react';

import { parseSymbol } from '@/lib/mana-symbols';
import { ManaSymbol } from '../shared/ManaSymbol';

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
      {parts.map((p, i) => {
        if (p.kind !== 'symbol') return <Fragment key={i}>{p.value}</Fragment>;
        const { token, split } = parseSymbol(p.value);
        return <ManaSymbol key={i} symbol={token} cost split={split} title={`{${p.value}}`} />;
      })}
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

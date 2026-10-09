import '@/styles/deck-builder-commander.css';
import { IconButton } from './Button';
import { ColorPip } from './ManaSymbol';

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
const COLOR_LABEL: Record<(typeof COLORS)[number], string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/**
 * The WUBRG + colorless filter: one toggle pip per color. Colorless is an
 * identity of its own, so picking it clears the colors and picking a color
 * clears it. Shared by the commander finder and the browse lists; the pips'
 * look lives with the finder (`styles/deck-builder-commander.css`).
 */
export function ColorIdentityPicker({
  colors,
  onChange,
}: {
  colors: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="commander-color-filter">
      {COLORS.map((c) => {
        const active = colors.has(c);
        return (
          <IconButton
            className={`commander-color-pip${active ? ' active' : ''}`}
            key={c}
            aria-pressed={active}
            onClick={() => {
              const next = new Set(colors);
              if (next.has(c)) {
                next.delete(c);
              } else {
                next.add(c);
                if (c === 'C') {
                  for (const other of [...next]) if (other !== 'C') next.delete(other);
                } else {
                  next.delete('C');
                }
              }
              onChange(next);
            }}
            label={COLOR_LABEL[c]}
            icon={<ColorPip color={c} pip={false} />}
          />
        );
      })}
    </div>
  );
}

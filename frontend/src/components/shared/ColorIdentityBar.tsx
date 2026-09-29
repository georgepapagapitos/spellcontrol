import './ColorIdentityBar.css';

/**
 * ColorIdentityBar — THE segmented color-identity strip under a deck tile's
 * banner: one equal-width flat segment per color, in the order given (callers
 * pass it most-used first, or WUBRG for a commander). A colorless deck gets a
 * single neutral segment, never an empty bar.
 *
 * Every deck tile in a grid wears it (the owner's index, Home's Your decks,
 * Discover, a profile or friend's library), so the same deck reads the same
 * wherever it shows up.
 * It used to be two copy-pasted families (`discover-tile-colorbar`,
 * `public-profile-tile-colorbar`) and was absent from the owner's own index.
 *
 * `aria-hidden`: decorative reinforcement. The tile's pips and its label say
 * the colors in a form a screen reader can use.
 */
export function ColorIdentityBar({ colors }: { colors: readonly string[] }) {
  return (
    <span className="color-identity-bar" aria-hidden="true">
      {(colors.length > 0 ? colors : ['C']).map((c, i) => (
        <span
          key={`${c}-${i}`}
          className={`color-identity-bar-seg color-identity-bar-seg--${c.toLowerCase()}`}
        />
      ))}
    </span>
  );
}

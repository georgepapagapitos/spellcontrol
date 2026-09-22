// The icon-font stylesheets, off the critical path.
//
// mana-font + keyrune are 13.7 KB gzipped between them — the two largest items
// in the render-blocking CSS, and bigger than any app stylesheet. They define a
// glyph class for every mana symbol and every set symbol ever printed, none of
// which the first paint needs: a visitor sees the shell, the nav and the hero
// before a single card symbol.
//
// Loaded as one dynamic import so Vite emits them as a single CSS chunk that
// the browser fetches without blocking the first paint. The three imports stay
// in THIS order, and stay together: `icon-fonts.css` re-points the vendor
// @font-face rules at our bbox-corrected woff2 builds and only wins by coming
// later in the cascade. Splitting them — leaving ours in the entry and
// deferring the vendor pair — would put the vendor rules last and hand the
// broken fonts back (see icon-fonts.css for what that costs).
import 'mana-font/css/mana.min.css';
import 'keyrune/css/keyrune.min.css';
import './icon-fonts.css';

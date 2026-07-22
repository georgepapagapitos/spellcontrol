import { BrandMark } from './BrandMark';

/**
 * Decorative brand-mark aura for PRIMARY (index/page-level) empty states —
 * see STYLE_GUIDE.md "Empty states". `motion="idle"` is the shipped breathing
 * aura (already reduced-motion-gated inside BrandMark.css); purely ambient —
 * aria-hidden, fixed size so it can never shift layout. Not for micro/
 * in-panel placeholders (those stay text-only).
 */
export function EmptyStateMark() {
  return (
    <div className="empty-state-mark" aria-hidden="true">
      <BrandMark size={40} motion="idle" />
    </div>
  );
}

/**
 * The brand mark: a binder page of two by two pockets, the first one filled.
 * Three ring dots sit on the page's spine edge. One colour (`currentColor`),
 * so it follows whatever ground it sits on; the seven empty pockets are the
 * same colour at reduced opacity. Decorative: the wordmark beside it carries
 * the name. Geometry is shared with `public/favicon.svg` and the app icons
 * (see style-guide/app-shell.md § Brand mark); a mark change edits both.
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <rect x="9" y="3" width="8.6" height="12" rx="1.6" />
      <rect x="19.6" y="3" width="8.6" height="12" rx="1.6" opacity=".38" />
      <rect x="9" y="17" width="8.6" height="12" rx="1.6" opacity=".38" />
      <rect x="19.6" y="17" width="8.6" height="12" rx="1.6" opacity=".38" />
      <circle cx="4" cy="9.5" r="2" />
      <circle cx="4" cy="16" r="2" />
      <circle cx="4" cy="22.5" r="2" />
    </svg>
  );
}

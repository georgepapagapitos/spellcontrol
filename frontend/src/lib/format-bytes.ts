/**
 * Human-readable byte sizes in decimal units (1 KB = 1000 B), the way the
 * platform file managers the app sits beside report them. Shared by the
 * offline-mode status line and the admin storage panel so both read the
 * same size the same way.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${Math.round(bytes)} B`;
}

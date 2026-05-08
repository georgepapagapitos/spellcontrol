export function getRegion(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith('America/')) return 'Americas';
    if (tz.startsWith('Europe/')) return 'Europe';
    if (tz.startsWith('Asia/')) return 'Asia';
    if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return 'Oceania';
    if (tz.startsWith('Africa/')) return 'Africa';
    return 'Other';
  } catch {
    return 'Other';
  }
}

export const isEuropean = (): boolean => getRegion() === 'Europe';

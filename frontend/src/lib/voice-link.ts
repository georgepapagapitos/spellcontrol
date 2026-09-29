/**
 * The label for a table's voice link. A Discord link says so, since that is
 * the app the click opens; anything else is just "the call".
 */
export function voiceLinkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'Join the call';
  }
  const discord = host === 'discord.gg' || host === 'discord.com' || host.endsWith('.discord.com');
  return discord ? 'Join on Discord' : 'Join the call';
}

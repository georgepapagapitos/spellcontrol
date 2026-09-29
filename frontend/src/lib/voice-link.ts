/** Whether a voice link opens Discord (an invite or a channel link). */
export function isDiscordLink(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === 'discord.gg' || host === 'discord.com' || host.endsWith('.discord.com');
}

/**
 * The label for a table's voice link. A Discord link says so, since that is
 * the app the click opens; anything else is just "the call".
 */
export function voiceLinkLabel(url: string): string {
  return isDiscordLink(url) ? 'Join on Discord' : 'Join the call';
}

import { useEffect, useState } from 'react';
import { getDiscordStatus, type DiscordStatus } from './games-api';

const OFF: DiscordStatus = { enabled: false, inviteUrl: null };

/**
 * What the server's Discord integration offers: Discord tables, and the
 * community invite. Everything stays hidden until the answer arrives, and on
 * any failure, so a Discord control only shows when using it can work.
 */
export function useDiscordStatus(): DiscordStatus {
  const [status, setStatus] = useState<DiscordStatus>(OFF);
  useEffect(() => {
    let live = true;
    getDiscordStatus()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return status;
}

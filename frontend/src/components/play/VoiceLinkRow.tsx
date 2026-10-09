import { Headphones } from 'lucide-react';
import { useState } from 'react';
import type { GameAction, GameState } from '@spellcontrol/game-core';
import { Button } from '@/components/shared/Button';
import { DiscordMark } from '@/components/shared/DiscordMark';
import { openDiscordTable } from '@/lib/play/games-api';
import { useDiscordStatus } from '@/lib/play/use-discord-status';
import { userMessage } from '@/lib/util/user-error';
import { isDiscordLink, voiceLinkLabel } from '@/lib/play/voice-link';

/**
 * Where the table talks: a Discord table the host opens, a voice channel in
 * the SpellControl server (see backend `discord.ts`). Discord or nothing; the
 * old paste-any-link field is gone, and the route refuses anything but a
 * discord.gg invite. Hidden entirely when the server has no Discord set up.
 */
export function VoiceLinkRow({
  game,
  dispatch,
}: {
  game: GameState;
  dispatch: (action: GameAction) => void;
}) {
  const saved = game.voiceUrl ?? '';
  const [error, setError] = useState<string | null>(null);
  const discordEnabled = useDiscordStatus().enabled;
  const [opening, setOpening] = useState(false);

  const openDiscord = async () => {
    setOpening(true);
    setError(null);
    // One press takes the host into the call. The tab opens now, inside the
    // click, because a browser blocks a window opened after the await; it is
    // pointed at the invite once the server answers.
    const tab = window.open('', '_blank');
    try {
      const url = await openDiscordTable(game.code);
      dispatch({ type: 'settings', patch: { voiceUrl: url } });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
    } catch (err) {
      tab?.close();
      setError(userMessage(err, "Couldn't open a Discord table. Try again in a moment."));
    } finally {
      setOpening(false);
    }
  };

  if (!saved && !discordEnabled) return null;

  return (
    <div className="lobby-setting lobby-setting--voice">
      <span className="lobby-voice-label">Voice</span>
      {saved ? (
        // A table made before Discord-only can still carry a pasted link;
        // it keeps working, just without Discord's mark.
        <Button
          href={saved}
          target="_blank"
          rel="noreferrer noopener"
          icon={
            isDiscordLink(saved) ? (
              <DiscordMark />
            ) : (
              <Headphones width={14} height={14} strokeWidth={1.8} />
            )
          }
        >
          {voiceLinkLabel(saved)}
        </Button>
      ) : (
        <>
          <Button icon={<DiscordMark />} disabled={opening} onClick={() => void openDiscord()}>
            {opening ? 'Opening a Discord table…' : 'Open a Discord table'}
          </Button>
          <p className="lobby-voice-hint">
            A voice channel in the SpellControl server. Anyone in the server can see it.
          </p>
        </>
      )}
      {error && (
        <p className="lobby-voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

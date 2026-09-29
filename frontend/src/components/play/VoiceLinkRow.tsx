import { Headphones } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GameAction, GameState } from '@/lib/play/game-state';
import { Button } from '@/components/shared/Button';
import { DiscordMark } from '@/components/shared/DiscordMark';
import { getDiscordTablesEnabled, openDiscordTable } from '@/lib/play/games-api';
import { userMessage } from '@/lib/util/user-error';
import { isDiscordLink, voiceLinkLabel } from '@/lib/play/voice-link';

/**
 * Where the table is talking. A link the host pastes, or a Discord table the
 * host opens (a voice channel in the SpellControl server, see backend
 * `discord.ts`), shown to everyone else as a link they can open. This app
 * does not carry voice; every pod already has somewhere it talks.
 *
 * Committed on blur or Enter rather than per keystroke: each commit is a
 * `settings` action that every seat sees, and one per character would flood
 * the lobby. Anything but an https link is refused by the route, so the row
 * says so before the round trip.
 */
export function VoiceLinkRow({
  game,
  dispatch,
}: {
  game: GameState;
  dispatch: (action: GameAction) => void;
}) {
  const saved = game.voiceUrl ?? '';
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // The host may not be the only one editing; take the server's value back
  // whenever it changes under us rather than holding a stale draft.
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (lastSaved.current !== saved) {
      lastSaved.current = saved;
      setDraft(saved);
    }
  }, [saved]);

  const commit = () => {
    const next = draft.trim();
    if (next === saved) return;
    if (next === '') {
      setError(null);
      dispatch({ type: 'settings', patch: { voiceUrl: null } });
      return;
    }
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      setError('That is not a link.');
      return;
    }
    if (url.protocol !== 'https:') {
      setError('Voice links start with https.');
      return;
    }
    setError(null);
    dispatch({ type: 'settings', patch: { voiceUrl: next } });
  };

  const discordEnabled = useDiscordTablesEnabled();
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

  return (
    <div className="lobby-setting lobby-setting--voice">
      <label className="lobby-voice-label" htmlFor="lobby-voice-url">
        Voice link
      </label>
      <input
        id="lobby-voice-url"
        className="lobby-voice-input"
        type="url"
        inputMode="url"
        value={draft}
        placeholder="Discord, Meet, anywhere"
        maxLength={2048}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        aria-describedby={error ? 'lobby-voice-error' : undefined}
      />
      {/* The host joins from here too, rather than copying their own link. */}
      {saved && (
        <div className="lobby-voice-discord">
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
        </div>
      )}
      {discordEnabled && !saved && (
        <div className="lobby-voice-discord">
          <Button icon={<DiscordMark />} disabled={opening} onClick={() => void openDiscord()}>
            {opening ? 'Opening a Discord table…' : 'Open a Discord table'}
          </Button>
          <p className="lobby-voice-hint">
            A voice channel in the SpellControl server. Anyone in the server can see it.
          </p>
        </div>
      )}
      {error && (
        <p className="lobby-voice-error" id="lobby-voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Whether the server can open Discord tables, so the button only shows when
 * pressing it can work. Hidden until the answer arrives, and on any failure.
 */
function useDiscordTablesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    getDiscordTablesEnabled()
      .then((on) => live && setEnabled(on))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

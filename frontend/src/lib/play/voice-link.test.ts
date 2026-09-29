import { describe, expect, it } from 'vitest';
import { voiceLinkLabel } from './voice-link';

describe('voiceLinkLabel', () => {
  it('names Discord for its invite and channel links', () => {
    expect(voiceLinkLabel('https://discord.gg/abc')).toBe('Join on Discord');
    expect(voiceLinkLabel('https://discord.com/channels/1/2')).toBe('Join on Discord');
    expect(voiceLinkLabel('https://ptb.discord.com/channels/1/2')).toBe('Join on Discord');
  });

  it('calls anything else the call', () => {
    expect(voiceLinkLabel('https://meet.google.com/abc')).toBe('Join the call');
    expect(voiceLinkLabel('https://notdiscord.gg/abc')).toBe('Join the call');
    expect(voiceLinkLabel('https://discord.gg.example.com/x')).toBe('Join the call');
    expect(voiceLinkLabel('not a url')).toBe('Join the call');
  });
});

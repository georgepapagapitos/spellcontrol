import { describe, expect, it } from 'vitest';
import { CUBE_FORMATS, FORMAT_INFO, formatExclusion } from './play-format';

describe('formatExclusion', () => {
  it('leaves Commander-only cards out of a limited cube (E288)', () => {
    // Real otag rows from the bundled index.
    const commandTower = [
      'commander-identity-matters',
      'rainbow-land',
      'synergy-commander',
      'commander-matters',
    ];
    const arcaneSignet = [
      'commander-identity-matters',
      'ramp',
      'mana-rock',
      'synergy-commander',
      'commander-matters',
    ];
    const prossh = ['synergy-commander'];
    expect(formatExclusion('limited', commandTower)).toBe('commanderOnly');
    expect(formatExclusion('limited', arcaneSignet)).toBe('commanderOnly');
    expect(formatExclusion('limited', prossh)).toBe('commanderOnly');
  });

  it('flags group-hug politics separately', () => {
    const secretRendezvous = [
      'burst-draw',
      'selective-group-hug',
      'group-hug',
      'draw',
      'symmetrical',
    ];
    expect(formatExclusion('limited', secretRendezvous)).toBe('politics');
  });

  it('keeps ordinary cards, untagged cards, and multiplayer-but-playable cards', () => {
    expect(formatExclusion('limited', ['burn', 'removal', 'spot-removal'])).toBeNull();
    expect(formatExclusion('limited', [])).toBeNull();
    // `multiplayer` alone (Kenrith, Breena) is a fine 1v1 card — not excluded.
    expect(formatExclusion('limited', ['multiplayer', 'typal'])).toBeNull();
  });

  it('excludes nothing in the commander format', () => {
    expect(formatExclusion('commander', ['commander-matters', 'group-hug'])).toBeNull();
  });

  it('describes every format', () => {
    for (const f of CUBE_FORMATS) {
      expect(FORMAT_INFO[f].label.length).toBeGreaterThan(0);
      expect(FORMAT_INFO[f].note.length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { checkRoleEvidence } from './roleEvidence';

describe('checkRoleEvidence', () => {
  it('confirms a role whose oracle text matches its evidence pattern', () => {
    expect(checkRoleEvidence('removal', 'Destroy target creature.')).toBe('removal');
  });

  it('drops a role the oracle text does not corroborate', () => {
    expect(checkRoleEvidence('removal', 'Vigilance.')).toBeNull();
  });

  it('trusts the tag when there is no oracle text to check', () => {
    expect(checkRoleEvidence('ramp', '')).toBe('ramp');
    expect(checkRoleEvidence('ramp', '   ')).toBe('ramp');
  });

  it('checks each role against its own pattern, not a shared one', () => {
    expect(checkRoleEvidence('ramp', 'Add {G}.')).toBe('ramp');
    expect(checkRoleEvidence('cardDraw', 'Add {G}.')).toBeNull();
    expect(checkRoleEvidence('boardwipe', 'Destroy all creatures.')).toBe('boardwipe');
    expect(checkRoleEvidence('cardDraw', 'Draw a card.')).toBe('cardDraw');
  });
});

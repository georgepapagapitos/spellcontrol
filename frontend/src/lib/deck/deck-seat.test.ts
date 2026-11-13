import { describe, expect, it } from 'vitest';
import { boundCopyId, COMMANDER_SEAT, PARTNER_SEAT, seatOf } from './deck-seat';

const deck = {
  cards: [{ slotId: 's1', allocatedCopyId: 'c1' }],
  commanderAllocatedCopyId: 'cmd-copy',
  partnerCommanderAllocatedCopyId: null,
} as unknown as Parameters<typeof boundCopyId>[0];

describe('deck seats', () => {
  it('names the seat behind each seat id, and nothing for a slot id', () => {
    expect(seatOf(COMMANDER_SEAT)).toBe('commander');
    expect(seatOf(PARTNER_SEAT)).toBe('partnerCommander');
    expect(seatOf('s1')).toBeNull();
  });

  it('reads the copy bound to a seat or a slot', () => {
    expect(boundCopyId(deck, COMMANDER_SEAT)).toBe('cmd-copy');
    expect(boundCopyId(deck, PARTNER_SEAT)).toBeNull();
    expect(boundCopyId(deck, 's1')).toBe('c1');
    expect(boundCopyId(deck, 'gone')).toBeNull();
  });
});

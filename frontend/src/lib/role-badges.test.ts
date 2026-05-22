import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// The tagger reads a bundled JSON keyed by card name; mock it so these
// tests exercise role-badges' own logic deterministically.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn(),
  getRampSubtype: vi.fn(),
  getRemovalSubtype: vi.fn(),
  getBoardwipeSubtype: vi.fn(),
  getCardDrawSubtype: vi.fn(),
  cardMatchesRole: vi.fn(),
  hasMultipleRoles: vi.fn(),
}));

import {
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
  cardMatchesRole,
  hasMultipleRoles,
} from '@/deck-builder/services/tagger/client';
import {
  getRoleBadge,
  isMultiRole,
  multiRoleTitle,
  rolesForCard,
  ROLE_BADGE_BY_TONE,
  ROLE_BADGE_GROUPS,
  ROLE_GROUP_BY_TONE,
} from './role-badges';

const mockGetCardRole = vi.mocked(getCardRole);
const mockGetRampSubtype = vi.mocked(getRampSubtype);
const mockGetRemovalSubtype = vi.mocked(getRemovalSubtype);
const mockGetBoardwipeSubtype = vi.mocked(getBoardwipeSubtype);
const mockGetCardDrawSubtype = vi.mocked(getCardDrawSubtype);
const mockCardMatchesRole = vi.mocked(cardMatchesRole);
const mockHasMultipleRoles = vi.mocked(hasMultipleRoles);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCardRole.mockReturnValue(null);
  mockGetRampSubtype.mockReturnValue(null);
  mockGetRemovalSubtype.mockReturnValue(null);
  mockGetBoardwipeSubtype.mockReturnValue(null);
  mockGetCardDrawSubtype.mockReturnValue(null);
  mockCardMatchesRole.mockReturnValue(false);
  mockHasMultipleRoles.mockReturnValue(false);
});

describe('getRoleBadge', () => {
  it('returns null when the card has no role', () => {
    expect(getRoleBadge({ name: 'Grizzly Bears' })).toBeNull();
  });

  it('returns null for an unrecognised role value', () => {
    mockGetCardRole.mockReturnValue('mystery' as RoleKey);
    expect(getRoleBadge({ name: 'Weird Card' })).toBeNull();
  });

  it('decodes ramp subtypes from explicit card fields', () => {
    expect(getRoleBadge({ name: 'x', deckRole: 'ramp', rampSubtype: 'mana-producer' })).toEqual({
      label: 'MP',
      title: 'Mana Producer',
      tone: 'mana-producer',
    });
    expect(getRoleBadge({ name: 'x', deckRole: 'ramp', rampSubtype: 'mana-rock' })?.label).toBe(
      'MR'
    );
    expect(getRoleBadge({ name: 'x', deckRole: 'ramp', rampSubtype: 'cost-reducer' })?.label).toBe(
      'CR'
    );
  });

  it('falls back to the plain ramp badge when no subtype is known', () => {
    expect(getRoleBadge({ name: 'x', deckRole: 'ramp' })).toEqual({
      label: 'RA',
      title: 'Ramp',
      tone: 'ramp',
    });
  });

  it('decodes removal subtypes', () => {
    expect(
      getRoleBadge({ name: 'x', deckRole: 'removal', removalSubtype: 'counterspell' })?.label
    ).toBe('CT');
    expect(getRoleBadge({ name: 'x', deckRole: 'removal', removalSubtype: 'bounce' })?.label).toBe(
      'BN'
    );
    expect(
      getRoleBadge({ name: 'x', deckRole: 'removal', removalSubtype: 'spot-removal' })?.label
    ).toBe('SR');
    expect(getRoleBadge({ name: 'x', deckRole: 'removal' })?.label).toBe('RE');
  });

  it('decodes board wipe subtypes', () => {
    expect(
      getRoleBadge({ name: 'x', deckRole: 'boardwipe', boardwipeSubtype: 'bounce-wipe' })?.label
    ).toBe('BW');
    expect(getRoleBadge({ name: 'x', deckRole: 'boardwipe' })?.label).toBe('WI');
  });

  it('decodes card draw subtypes', () => {
    expect(getRoleBadge({ name: 'x', deckRole: 'cardDraw', cardDrawSubtype: 'tutor' })?.label).toBe(
      'TU'
    );
    expect(getRoleBadge({ name: 'x', deckRole: 'cardDraw', cardDrawSubtype: 'wheel' })?.label).toBe(
      'WH'
    );
    expect(
      getRoleBadge({ name: 'x', deckRole: 'cardDraw', cardDrawSubtype: 'cantrip' })?.label
    ).toBe('CN');
    expect(
      getRoleBadge({ name: 'x', deckRole: 'cardDraw', cardDrawSubtype: 'card-draw' })?.label
    ).toBe('DR');
    expect(getRoleBadge({ name: 'x', deckRole: 'cardDraw' })?.label).toBe('CA');
  });

  it('falls back to the tagger when card fields are empty', () => {
    mockGetCardRole.mockReturnValue('cardDraw');
    mockGetCardDrawSubtype.mockReturnValue('wheel');
    expect(getRoleBadge({ name: 'Windfall' })?.label).toBe('WH');
    expect(mockGetCardRole).toHaveBeenCalledWith('Windfall');
  });
});

describe('rolesForCard / multiRoleTitle', () => {
  it('lists every role a card fills, in canonical order', () => {
    mockCardMatchesRole.mockImplementation((_name, role) => role === 'ramp' || role === 'cardDraw');
    expect(rolesForCard({ name: 'x' })).toEqual(['ramp', 'cardDraw']);
    expect(multiRoleTitle({ name: 'x' })).toBe('Ramp + Card Advantage');
  });

  it('falls back to "Multi-role" when no role matches', () => {
    expect(multiRoleTitle({ name: 'x' })).toBe('Multi-role');
  });
});

describe('isMultiRole', () => {
  it('trusts the generator-set multiRole flag without calling the tagger', () => {
    expect(isMultiRole({ name: 'x', multiRole: true })).toBe(true);
    expect(isMultiRole({ name: 'x', multiRole: false })).toBe(false);
    expect(mockHasMultipleRoles).not.toHaveBeenCalled();
  });

  it('falls back to the tagger for hand-built cards', () => {
    mockHasMultipleRoles.mockReturnValue(true);
    expect(isMultiRole({ name: 'Beast Within' })).toBe(true);
    expect(mockHasMultipleRoles).toHaveBeenCalledWith('Beast Within');
  });
});

describe('role badge tables', () => {
  it('maps every tone to its top-level group', () => {
    expect(ROLE_GROUP_BY_TONE['mana-rock']).toBe('Ramp');
    expect(ROLE_GROUP_BY_TONE['counterspell']).toBe('Removal');
    expect(ROLE_GROUP_BY_TONE['bounce-wipe']).toBe('Board wipe');
    expect(ROLE_GROUP_BY_TONE['cantrip']).toBe('Card draw');
  });

  it('keeps the legend groups in sync with the badge table', () => {
    for (const group of ROLE_BADGE_GROUPS) {
      for (const tone of group.tones) {
        expect(ROLE_BADGE_BY_TONE[tone]).toBeDefined();
      }
    }
  });
});

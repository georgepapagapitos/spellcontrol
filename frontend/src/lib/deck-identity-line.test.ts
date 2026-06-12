import { describe, it, expect } from 'vitest';
import { buildIdentityLine } from './deck-identity-line';
import type {
  ValidationCheck,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { DeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';

function makeValidation(checks: ValidationCheck[]): ValidationResult {
  return {
    checks,
    passCount: checks.filter((c) => c.status === 'pass').length,
    total: checks.length,
    hardFails: checks.filter((c) => c.status === 'fail').length,
    softWarns: checks.filter((c) => c.status === 'warn').length,
  };
}

const PASS = (id: string): ValidationCheck => ({ id, label: id, status: 'pass', detail: 'ok' });
const FAIL = (id: string): ValidationCheck => ({ id, label: id, status: 'fail', detail: 'bad' });
const WARN = (_id: string): ValidationCheck => ({
  id: 'ramp',
  label: 'Ramp count',
  status: 'warn',
  detail: '4/10',
});

const mockIdentity: DeckIdentity = {
  archetypeLabel: 'Tokens',
  pacingShort: 'Late game',
  themes: ['Tokens', 'Go-wide'],
};

const allClearValidation = makeValidation([PASS('size'), PASS('identity')]);
const failValidation = makeValidation([FAIL('size')]);
const warnValidation = makeValidation([PASS('size'), WARN('ramp')]);

describe('buildIdentityLine', () => {
  it('returns archetype, bracket, validation segments in order for a full commander deck', () => {
    const segments = buildIdentityLine({
      identity: mockIdentity,
      formatLabel: 'Commander',
      bracket: 3,
      validation: allClearValidation,
    });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ kind: 'archetype', text: 'Late game Tokens deck' });
    expect(segments[1]).toMatchObject({ kind: 'bracket', text: 'Bracket 3', tipText: 'Upgraded' });
    expect(segments[2]).toMatchObject({ kind: 'validation', text: 'All clear', tone: 'success' });
  });

  it('omits bracket segment when bracket is undefined', () => {
    const segments = buildIdentityLine({
      identity: mockIdentity,
      formatLabel: 'Commander',
      bracket: undefined,
      validation: allClearValidation,
    });
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.kind !== 'bracket')).toBe(true);
  });

  it('uses format label as archetype when identity is null (no commander)', () => {
    const segments = buildIdentityLine({
      identity: null,
      formatLabel: 'Standard',
      bracket: undefined,
      validation: allClearValidation,
    });
    expect(segments[0]).toMatchObject({ kind: 'archetype', text: 'Standard deck' });
  });

  it('validation tone is err when there are hard fails', () => {
    const segments = buildIdentityLine({
      identity: mockIdentity,
      formatLabel: 'Commander',
      bracket: 2,
      validation: failValidation,
    });
    const valSeg = segments.find((s) => s.kind === 'validation');
    expect(valSeg?.tone).toBe('err');
    expect(valSeg?.text).toMatch(/to fix/);
  });

  it('validation tone is warn when there are soft warnings only', () => {
    const segments = buildIdentityLine({
      identity: mockIdentity,
      formatLabel: 'Commander',
      bracket: 2,
      validation: warnValidation,
    });
    const valSeg = segments.find((s) => s.kind === 'validation');
    expect(valSeg?.tone).toBe('warn');
    expect(valSeg?.text).toMatch(/to tune/);
  });

  it('bracket tipText maps BRACKET_LABELS correctly (all 5 brackets)', () => {
    const labels: Record<number, string> = {
      1: 'Exhibition',
      2: 'Core',
      3: 'Upgraded',
      4: 'Optimized',
      5: 'cEDH',
    };
    for (const [n, label] of Object.entries(labels)) {
      const segs = buildIdentityLine({
        identity: mockIdentity,
        formatLabel: 'Commander',
        bracket: Number(n),
        validation: allClearValidation,
      });
      const bracketSeg = segs.find((s) => s.kind === 'bracket');
      expect(bracketSeg?.tipText).toBe(label);
    }
  });

  it('no-commander + no-bracket: only archetype + validation segments', () => {
    const segments = buildIdentityLine({
      identity: null,
      formatLabel: 'Pauper',
      bracket: undefined,
      validation: allClearValidation,
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe('archetype');
    expect(segments[1].kind).toBe('validation');
  });

  it('archetype text does not contain raw numbers', () => {
    const segments = buildIdentityLine({
      identity: mockIdentity,
      formatLabel: 'Commander',
      bracket: 3,
      validation: allClearValidation,
    });
    const archetypeSeg = segments[0];
    expect(archetypeSeg.text).not.toMatch(/\d+/); // no raw numbers
  });
});

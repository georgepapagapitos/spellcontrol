import { describe, expect, it } from 'vitest';
import { resolveGenerationDestination } from './use-deck-generation';

describe('resolveGenerationDestination', () => {
  it('routes to the compare diff when the regenerate source deck still exists', () => {
    expect(resolveGenerationDestination('new-id', 'source-id', new Set(['source-id']))).toBe(
      '/decks/compare?a=source-id&b=new-id'
    );
  });

  it('falls back to the new deck editor when there is no source (a fresh build)', () => {
    expect(resolveGenerationDestination('new-id', undefined, new Set(['source-id']))).toBe(
      '/decks/new-id'
    );
  });

  it('falls back to the new deck editor when the source deck was deleted mid-generation', () => {
    expect(resolveGenerationDestination('new-id', 'source-id', new Set())).toBe('/decks/new-id');
  });
});

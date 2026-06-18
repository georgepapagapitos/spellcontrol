import { describe, it, expect } from 'vitest';
import { toCubeCobraList } from './format';
import { Pick } from './generate';

const pick = (name: string): Pick => ({
  card: { name, oracleId: name, colors: [], cmc: 0, typeLine: '', role: null },
  bucket: 'colorless',
  reason: '',
});

describe('toCubeCobraList', () => {
  it('emits one alphabetized card name per line', () => {
    expect(toCubeCobraList([pick('Sol Ring'), pick('Ancestral Recall'), pick('Black Lotus')])).toBe(
      'Ancestral Recall\nBlack Lotus\nSol Ring'
    );
  });
});

import { describe, it, expect } from 'vitest';
import { curveShapeFromAvgCmc } from './deckAnalyzer';

// E78 item 2: getDeckSummaryData's headline and getCurveGrade's C/D message
// both used to derive "top-heavy"/"curve skews low" from an EDHREC-relative
// comparison (this deck's low/high-CMC card count vs the reference
// commander's typical curve), which could contradict the avgCmc number
// printed right next to it — a real Kozilek build (avgCmc 4.42-4.53, an
// 11-12 card CMC-7+ spike) was labeled "curve skews low", and a normal
// Isshin build (avgCmc 3.28-3.37) was labeled "top-heavy". Both functions now
// derive the shape word from this single, absolute avgCmc threshold instead.
describe('curveShapeFromAvgCmc', () => {
  it('calls a high avg CMC top-heavy (Kozilek-shaped: 4.42)', () => {
    expect(curveShapeFromAvgCmc(4.42)).toBe('top-heavy');
  });

  it('does not call a normal avg CMC top-heavy (Isshin-shaped: 3.28)', () => {
    expect(curveShapeFromAvgCmc(3.28)).toBeNull();
  });

  it('calls a low avg CMC bottom-heavy', () => {
    expect(curveShapeFromAvgCmc(2.1)).toBe('bottom-heavy');
  });

  it('treats 0 (no nonland cards) as neutral, not bottom-heavy', () => {
    expect(curveShapeFromAvgCmc(0)).toBeNull();
  });
});

// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ASK_CARDS, rulesQuestionAbout, useAskRules } from './use-ask-rules';

const aiState: { status: object | null | undefined } = { status: null };
vi.mock('./use-ai-status', () => ({ useAiStatus: () => aiState.status }));

beforeEach(() => {
  aiState.status = null;
});

describe('rulesQuestionAbout', () => {
  it('asks how one card works, and how several interact', () => {
    expect(rulesQuestionAbout(['Blood Moon'])).toBe('How does Blood Moon work?');
    expect(rulesQuestionAbout(['Blood Moon', 'Urborg, Tomb of Yawgmoth'])).toBe(
      'How do Blood Moon and Urborg, Tomb of Yawgmoth interact?'
    );
    expect(rulesQuestionAbout(['A', 'B', 'C'])).toBe('How do A, B and C interact?');
  });

  it('names a card once however many copies were picked', () => {
    expect(rulesQuestionAbout(['Rat Colony', 'Rat Colony'])).toBe('How does Rat Colony work?');
  });

  // Double-faced names ("A // B") run longest among commander-legal cards,
  // still under 80 characters.
  it('keeps the largest question under the Q&A limit of 500 characters', () => {
    const longest = Array.from({ length: MAX_ASK_CARDS }, (_, i) => `${'X'.repeat(79)}${i}`);
    expect(rulesQuestionAbout(longest).length).toBeLessThan(500);
  });
});

describe('useAskRules', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/decks/1']}>{children}</MemoryRouter>
  );

  it('is null while AI is unavailable or still loading', () => {
    expect(renderHook(() => useAskRules(), { wrapper }).result.current).toBeNull();
    aiState.status = undefined;
    expect(renderHook(() => useAskRules(), { wrapper }).result.current).toBeNull();
  });

  it('opens Ask with the question seeded, never sent', () => {
    aiState.status = { optIn: true, used: 0, limit: 10 };
    const { result } = renderHook(() => ({ ask: useAskRules(), loc: useLocation() }), { wrapper });
    act(() => result.current.ask!(['Counterspell', 'Ulamog, the Ceaseless Hunger']));
    expect(result.current.loc.pathname + result.current.loc.search).toBe('/rules?tab=ask');
    expect(result.current.loc.state).toEqual({
      question: 'How do Counterspell and Ulamog, the Ceaseless Hunger interact?',
    });
  });
});

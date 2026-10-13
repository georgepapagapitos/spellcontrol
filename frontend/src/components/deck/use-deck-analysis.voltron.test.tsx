// @vitest-environment happy-dom
/**
 * The deck view's identity strip names the commander's themes from its profile. A commander
 * whose EDHREC page vetoes voltron (golden.md R11) must not show it there once the page is
 * cached, and keeps the text reading when nothing cached it (no request is made to find out).
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import {
  vetoedCard,
  vetoedPage,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';
import { useDeckAnalysis } from './use-deck-analysis';

function mount(name: string) {
  const commander = vetoedCard(name);
  return renderHook(() =>
    useDeckAnalysis({
      cards: [],
      sideboardCount: 0,
      commander,
      partnerCommander: null,
      formatConfig: DECK_FORMAT_CONFIGS.commander,
      illegalCardNames: [],
      taggerReady: false,
      selectedThemes: undefined,
      archetypeOverride: undefined,
      buildReport: undefined,
      roleCounts: undefined,
      roleTargets: undefined,
      rampSubtypeCounts: undefined,
      removalSubtypeCounts: undefined,
      boardwipeSubtypeCounts: undefined,
      cardDrawSubtypeCounts: undefined,
    } as unknown as Parameters<typeof useDeckAnalysis>[0])
  );
}

describe('useDeckAnalysis identity', () => {
  it('reads voltron from the text, then drops it when the commander page is cached', () => {
    const name = "Gishath, Sun's Avatar";
    const { result } = mount(name);
    expect(result.current.identity?.themes).toContain('voltron');
    act(() => void vetoedPage(name));
    expect(result.current.identity?.themes).not.toContain('voltron');
  });

  it('keeps the text reading for a commander whose page was never cached', () => {
    expect(mount('Maha, Its Feathers Night').result.current.identity?.themes).toContain('voltron');
  });
});

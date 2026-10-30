import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  isRulesReferenceTab,
  RulesReference,
  RulesReferenceFoot,
  useRulesBundle,
} from '@/components/rules/RulesReference';
import { type RulesReferenceTab } from '@/store/rules-reference';
import { Tabs } from '@/components/overlays/Tabs';
import { Button } from '@/components/shared/Button';
import './RulesPage.css';

/**
 * `/rules` — the Rules hub, the linkable home of the offline Comprehensive
 * Rules reference: Keywords, Glossary and Rules, the same lists the in-game
 * Rules Reference sheet shows. The sheet stays the quick look for mid-game;
 * this page is the place you can link, bookmark and search from the header,
 * the palette, and You › Help. Its door leads to the stack walkthroughs.
 *
 * The section and search live in the URL (`?tab=`, `?q=`) so a rule lookup
 * is a shareable address.
 */
export function RulesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const bundle = useRulesBundle();

  const requested = params.get('tab');
  const [tab, setTabRaw] = useState<RulesReferenceTab>(
    isRulesReferenceTab(requested) ? requested : 'keywords'
  );
  const [query, setQueryRaw] = useState(() => params.get('q') ?? '');

  // Mirror both into the URL with `replace`: typing a search is one visit,
  // not a Back-button trail.
  const setTab = (t: RulesReferenceTab) => {
    setTabRaw(t);
    setParams(
      (p) => {
        p.set('tab', t);
        return p;
      },
      { replace: true }
    );
  };
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setParams(
      (p) => {
        if (q.trim()) p.set('q', q);
        else p.delete('q');
        return p;
      },
      { replace: true }
    );
  };

  const tabs = [
    { id: 'keywords' as const, label: 'Keywords', controls: 'rules-ref-panel' },
    { id: 'glossary' as const, label: 'Glossary', controls: 'rules-ref-panel' },
    { id: 'rules' as const, label: 'Rules', controls: 'rules-ref-panel' },
  ];

  return (
    <div className="rules-page">
      <header className="rules-page-header">
        <h1 className="rules-page-heading">Rules</h1>
        <p className="rules-page-sub">Search the Comprehensive Rules by keyword or rule number.</p>
        <Button
          variant="link"
          to="/rules/walkthroughs"
          className="rules-page-door"
          iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
        >
          Step through the stack
        </Button>
      </header>

      <Tabs<RulesReferenceTab>
        tabs={tabs}
        value={tab}
        onChange={setTab}
        ariaLabel="Rules sections"
        variant="underline"
        className="rules-page-tabs"
      />

      <RulesReference
        bundle={bundle}
        tab={tab}
        query={query}
        onTabChange={setTab}
        onQueryChange={setQuery}
        showTabs={false}
        // Until the bundle lands the body holds the viewport, so the foot and
        // the footer aren't painted mid-screen and then shoved away (CLS 0.17
        // on desktop, E1049). Page-only: the in-game sheet keeps its line.
        bodyClassName={bundle === null ? 'rules-page-body--loading' : undefined}
        // Search's keyword row opens its rule with the subrules showing,
        // the way a keyword in card text opens the sheet.
        initialExpanded={(location.state as { expand?: string } | null)?.expand}
      />
      <RulesReferenceFoot bundle={bundle} />
    </div>
  );
}

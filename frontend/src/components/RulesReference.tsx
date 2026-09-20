import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SearchPill } from './SearchPill';
import { Tabs } from './Tabs';
import { openEntryMenu, RulesEntryMenu, type RulesEntry } from './RulesEntryMenu';
import {
  loadRulesBundle,
  searchGlossary,
  searchKeywords,
  searchRules,
  subrulesFor,
  type RulesBundle,
} from '../lib/comprehensive-rules';
import './RulesReference.css';

/** The three sections of the Comprehensive Rules reference. */
export type RulesReferenceTab = 'keywords' | 'glossary' | 'rules';

export const RULES_REFERENCE_TABS: ReadonlySet<string> = new Set(['keywords', 'glossary', 'rules']);

export function isRulesReferenceTab(v: string | null | undefined): v is RulesReferenceTab {
  return !!v && RULES_REFERENCE_TABS.has(v);
}

/**
 * A query that is only a rule number: "701", "701.2", "702.2b". Three digits
 * before anything counts — a section number is the shortest real one, and
 * fewer would yank the tab away mid-keystroke.
 */
const RULE_NUMBER = /^\d{3}(\.\d+[a-z]?)?$/;

const PLACEHOLDER: Record<RulesReferenceTab, string> = {
  keywords: 'Search keywords',
  glossary: 'Search terms',
  rules: 'Search rules or jump to a number',
};

/**
 * The rules bundle, loaded once (the loader is a singleton promise). `null`
 * while loading, `'error'` when the fetch failed.
 */
export function useRulesBundle(): RulesBundle | null | 'error' {
  const [state, setState] = useState<RulesBundle | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    loadRulesBundle().then(
      (b) => alive && setState(b),
      () => alive && setState('error')
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

interface Props {
  bundle: RulesBundle | null | 'error';
  tab: RulesReferenceTab;
  query: string;
  onTabChange: (tab: RulesReferenceTab) => void;
  onQueryChange: (query: string) => void;
  /** Whether the search field takes focus on mount (never on touch — see callers). */
  autoFocusSearch?: boolean;
  /**
   * The section strip. `true` (the sheet) renders the Keywords / Glossary /
   * Rules tabs here; `false` (the /rules page) leaves the strip to the caller,
   * whose own tabs use the same ids so the panel's `aria-labelledby` still
   * resolves.
   */
  showTabs?: boolean;
  searchClassName?: string;
  bodyClassName?: string;
  /** Present while AI is available: every row's menu can hand it to Ask. */
  onAsk?: (question: string) => void;
  /** Called before a row's menu navigates elsewhere (the sheet closes). */
  onLeave?: () => void;
}

/**
 * The Comprehensive Rules reference — keywords, glossary and rule-number
 * search over the offline bundle. Controlled: the caller owns the tab and
 * query so it can mirror them where it likes (the sheet in state, the `/rules`
 * page in the URL). Rendered inside the Rules Reference sheet and, inline, as
 * the body of the `/rules` page — one set of lists, one search, one look.
 */
export function RulesReference({
  bundle,
  tab,
  query,
  onTabChange,
  onQueryChange,
  autoFocusSearch = false,
  showTabs = true,
  searchClassName,
  bodyClassName,
  onAsk,
  onLeave,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const loaded = bundle && bundle !== 'error' ? bundle : null;

  // term → one-line glossary definition, for the keyword summaries.
  const glossaryByTerm = useMemo(() => {
    const m = new Map<string, string>();
    loaded?.glossary.forEach((g) => m.set(g.term.toLowerCase(), g.definition));
    return m;
  }, [loaded]);

  // Jump to a specific rule number from any "see rule …" reference.
  const jumpToRule = (number: string) => {
    onTabChange('rules');
    onQueryChange(number);
    setExpanded(null);
  };

  const menu: MenuProps = { onAsk, onLeave };

  /**
   * Typing a rule number anywhere in the reference goes to the rules. Keywords
   * and the glossary are indexed by name, so a number searched there found
   * nothing and said so — while the answer sat one tab over.
   */
  const handleQueryChange = (next: string) => {
    onQueryChange(next);
    if (tab !== 'rules' && RULE_NUMBER.test(next.trim())) {
      onTabChange('rules');
      setExpanded(null);
    }
  };

  const tabs = [
    { id: 'keywords' as const, label: 'Keywords', controls: 'rules-ref-panel' },
    { id: 'glossary' as const, label: 'Glossary', controls: 'rules-ref-panel' },
    { id: 'rules' as const, label: 'Rules', controls: 'rules-ref-panel' },
  ];

  return (
    <>
      <div className={`rules-ref-search${searchClassName ? ` ${searchClassName}` : ''}`}>
        <SearchPill
          value={query}
          onChange={handleQueryChange}
          placeholder={PLACEHOLDER[tab]}
          ariaLabel="Search rules reference"
          autoFocus={autoFocusSearch}
        />
      </div>

      {showTabs && (
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(t) => {
            onTabChange(t);
            setExpanded(null);
          }}
          ariaLabel="Rules reference sections"
          variant="fitted"
          className="rules-ref-tabs"
        />
      )}

      <div
        className={`rules-ref-body${bodyClassName ? ` ${bodyClassName}` : ''}`}
        role="tabpanel"
        id="rules-ref-panel"
        aria-labelledby={`sc-tab-${tab}`}
      >
        {bundle === 'error' ? (
          <p className="rules-ref-status">
            Couldn't load the rules. Check your connection and try again.
          </p>
        ) : !loaded ? (
          <p className="rules-ref-status" aria-busy="true">
            Loading rules…
          </p>
        ) : tab === 'keywords' ? (
          <KeywordList
            bundle={loaded}
            query={query}
            expanded={expanded}
            onToggle={(name) => setExpanded((cur) => (cur === name ? null : name))}
            glossaryByTerm={glossaryByTerm}
            onJump={jumpToRule}
            menu={menu}
          />
        ) : tab === 'glossary' ? (
          <GlossaryList bundle={loaded} query={query} onJump={jumpToRule} menu={menu} />
        ) : (
          <RulesList bundle={loaded} query={query} onJump={jumpToRule} menu={menu} />
        )}
      </div>
    </>
  );
}

/** "Comprehensive Rules, effective …" — the provenance line under either surface. */
export function RulesReferenceFoot({
  bundle,
  className,
}: {
  bundle: RulesBundle | null | 'error';
  className?: string;
}) {
  const effective = bundle && bundle !== 'error' ? bundle.meta.effective : '—';
  return (
    <p className={`rules-ref-foot${className ? ` ${className}` : ''}`}>
      Comprehensive Rules, effective {effective}
    </p>
  );
}

/** Splits text on rule-number references and renders them as jump buttons. */
function withRuleLinks(text: string, onJump: (n: string) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\d{3}\.\d+[a-z]?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const num = m[0];
    parts.push(
      <button key={m.index} type="button" className="rules-ref-link" onClick={() => onJump(num)}>
        {num}
      </button>
    );
    last = m.index + num.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Empty({ what }: { what: string }) {
  return <p className="rules-ref-status">No {what} match your search.</p>;
}

type MenuProps = Pick<Props, 'onAsk' | 'onLeave'>;

const address = (tab: RulesReferenceTab, q: string) =>
  `/rules?tab=${tab}&q=${encodeURIComponent(q)}`;

/** One numbered rule: its number, its text with jump links, and its menu. */
function RuleRow({
  number,
  text,
  onJump,
  menu,
}: {
  number: string;
  text: string;
  onJump: (n: string) => void;
  menu: MenuProps;
}) {
  const entry: RulesEntry = {
    label: `Rule ${number}`,
    text: `${number} ${text}`,
    href: address('rules', number),
    question: `Explain rule ${number}.`,
  };
  return (
    <div className="rules-ref-rule" onContextMenu={openEntryMenu}>
      <span className="rules-ref-rule-num">{number}</span>
      <span className="rules-ref-rule-text">{withRuleLinks(text, onJump)}</span>
      <RulesEntryMenu entry={entry} {...menu} />
    </div>
  );
}

function KeywordList({
  bundle,
  query,
  expanded,
  onToggle,
  glossaryByTerm,
  onJump,
  menu,
}: {
  bundle: RulesBundle;
  query: string;
  expanded: string | null;
  onToggle: (name: string) => void;
  glossaryByTerm: Map<string, string>;
  onJump: (n: string) => void;
  menu: MenuProps;
}) {
  const results = useMemo(() => searchKeywords(bundle.keywords, query), [bundle, query]);
  if (results.length === 0) return <Empty what="keywords" />;
  return (
    <ul className="rules-ref-list" role="list">
      {results.map((k) => {
        const isOpen = expanded === k.name;
        const summary = glossaryByTerm.get(k.name.toLowerCase());
        const entry: RulesEntry = {
          label: k.name,
          text: summary ? `${k.name} (${k.rule}): ${summary}` : `${k.name}, rule ${k.rule}`,
          href: address('keywords', k.name),
          keyword: k.kind === 'ability' ? k.name : undefined,
          question: `How does ${k.name} work?`,
        };
        return (
          <li
            key={`${k.kind}-${k.rule}`}
            className="rules-ref-keyword"
            onContextMenu={openEntryMenu}
          >
            <div className="rules-ref-keyword-row">
              <button
                type="button"
                className="rules-ref-keyword-head"
                aria-expanded={isOpen}
                onClick={() => onToggle(k.name)}
              >
                <span className="rules-ref-keyword-name">{k.name}</span>
                <span className={`rules-ref-badge rules-ref-badge-${k.kind}`}>{k.kind}</span>
                <span className="rules-ref-keyword-rule">{k.rule}</span>
              </button>
              <RulesEntryMenu entry={entry} {...menu} />
            </div>
            {summary && !isOpen && <p className="rules-ref-keyword-summary">{summary}</p>}
            {isOpen && (
              <div className="rules-ref-keyword-body">
                {subrulesFor(bundle.rules, k.rule).map((r) => (
                  <RuleRow
                    key={r.number}
                    number={r.number}
                    text={r.text}
                    onJump={onJump}
                    menu={menu}
                  />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GlossaryList({
  bundle,
  query,
  onJump,
  menu,
}: {
  bundle: RulesBundle;
  query: string;
  onJump: (n: string) => void;
  menu: MenuProps;
}) {
  // ponytail: renders all ~720 terms unfiltered; plain rows so it's fine. Add
  // virtualization if the glossary ever balloons.
  const results = useMemo(() => searchGlossary(bundle.glossary, query), [bundle, query]);
  if (results.length === 0) return <Empty what="terms" />;
  return (
    <dl className="rules-ref-glossary">
      {results.map((g) => (
        <div key={g.term} className="rules-ref-glossary-entry" onContextMenu={openEntryMenu}>
          <dt className="rules-ref-glossary-term">
            <span>{g.term}</span>
            <RulesEntryMenu
              entry={{
                label: g.term,
                text: `${g.term}: ${g.definition}`,
                href: address('glossary', g.term),
                question: `What does "${g.term}" mean in the rules?`,
              }}
              {...menu}
            />
          </dt>
          <dd className="rules-ref-glossary-def">{withRuleLinks(g.definition, onJump)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RulesList({
  bundle,
  query,
  onJump,
  menu,
}: {
  bundle: RulesBundle;
  query: string;
  onJump: (n: string) => void;
  menu: MenuProps;
}) {
  const LIMIT = 200;
  const results = useMemo(() => searchRules(bundle.rules, query, LIMIT), [bundle, query]);
  if (results.length === 0) return <Empty what="rules" />;
  return (
    <div className="rules-ref-rules">
      {results.map((r) => (
        <RuleRow key={r.number} number={r.number} text={r.text} onJump={onJump} menu={menu} />
      ))}
      {results.length >= LIMIT && (
        <p className="rules-ref-status">Showing the first {LIMIT} matches. Refine your search.</p>
      )}
    </div>
  );
}

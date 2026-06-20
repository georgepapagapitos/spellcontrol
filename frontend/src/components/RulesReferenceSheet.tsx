import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { SearchPill } from './SearchPill';
import { Tabs } from './Tabs';
import {
  loadRulesBundle,
  searchGlossary,
  searchKeywords,
  searchRules,
  subrulesFor,
  type RulesBundle,
} from '../lib/comprehensive-rules';
import { useRulesReferenceStore } from '../store/rules-reference';
import './RulesReferenceSheet.css';

type Tab = 'keywords' | 'glossary' | 'rules';

/** Mount gate — keeps all hooks inside the body so the sheet can lazy-mount. */
export function RulesReferenceSheet() {
  const isOpen = useRulesReferenceStore((s) => s.isOpen);
  const close = useRulesReferenceStore((s) => s.close);
  if (!isOpen) return null;
  return <RulesReferenceBody onClose={close} />;
}

const PLACEHOLDER: Record<Tab, string> = {
  keywords: 'Search keywords (e.g. flying, scry)…',
  glossary: 'Search terms…',
  rules: 'Search rules, or jump to a number (e.g. 509.2)…',
};

function RulesReferenceBody({ onClose }: { onClose: () => void }) {
  const [bundle, setBundle] = useState<RulesBundle | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>('keywords');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const labelId = useId();

  // Don't autofocus the search on touch — it raises the soft keyboard the
  // instant the sheet opens and squashes the layout. Desktop (fine pointer +
  // hover, per the project's touch gate) still gets focus-on-open for typing.
  const autoFocusSearch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'modal-panel-out');

  useEffect(() => {
    let alive = true;
    loadRulesBundle().then(
      (b) => alive && setBundle(b),
      () => alive && setLoadError(true)
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose]);

  // term → one-line glossary definition, for the keyword summaries.
  const glossaryByTerm = useMemo(() => {
    const m = new Map<string, string>();
    bundle?.glossary.forEach((g) => m.set(g.term.toLowerCase(), g.definition));
    return m;
  }, [bundle]);

  // Jump to a specific rule number from any "see rule …" reference.
  const jumpToRule = (number: string) => {
    setTab('rules');
    setQuery(number);
    setExpanded(null);
  };

  const tabs = [
    { id: 'keywords' as const, label: 'Keywords', controls: 'rules-ref-panel' },
    { id: 'glossary' as const, label: 'Glossary', controls: 'rules-ref-panel' },
    { id: 'rules' as const, label: 'Rules', controls: 'rules-ref-panel' },
  ];

  return (
    <div
      className={`modal-backdrop rules-ref-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={() => beginClose()}
      role="presentation"
    >
      <div
        className={`modal rules-ref-modal${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="modal-header rules-ref-header">
          <h2 id={labelId}>Rules reference</h2>
          <button className="modal-close" onClick={() => beginClose()} aria-label="Close">
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <div className="rules-ref-search">
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder={PLACEHOLDER[tab]}
            ariaLabel="Search rules reference"
            autoFocus={autoFocusSearch}
          />
        </div>

        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setExpanded(null);
          }}
          ariaLabel="Rules reference sections"
          variant="underline"
          className="rules-ref-tabs"
        />

        <div
          className="modal-body rules-ref-body"
          role="tabpanel"
          id="rules-ref-panel"
          aria-labelledby={`sc-tab-${tab}`}
        >
          {loadError ? (
            <p className="rules-ref-status">
              Couldn’t load the rules. Check your connection and reopen.
            </p>
          ) : !bundle ? (
            <p className="rules-ref-status" aria-busy="true">
              Loading rules…
            </p>
          ) : tab === 'keywords' ? (
            <KeywordList
              bundle={bundle}
              query={query}
              expanded={expanded}
              onToggle={(name) => setExpanded((cur) => (cur === name ? null : name))}
              glossaryByTerm={glossaryByTerm}
              onJump={jumpToRule}
            />
          ) : tab === 'glossary' ? (
            <GlossaryList bundle={bundle} query={query} onJump={jumpToRule} />
          ) : (
            <RulesList bundle={bundle} query={query} onJump={jumpToRule} />
          )}
        </div>

        <p className="rules-ref-foot">
          Comprehensive Rules, effective {bundle?.meta.effective ?? '—'}
        </p>
      </div>
    </div>
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

function KeywordList({
  bundle,
  query,
  expanded,
  onToggle,
  glossaryByTerm,
  onJump,
}: {
  bundle: RulesBundle;
  query: string;
  expanded: string | null;
  onToggle: (name: string) => void;
  glossaryByTerm: Map<string, string>;
  onJump: (n: string) => void;
}) {
  const results = useMemo(() => searchKeywords(bundle.keywords, query), [bundle, query]);
  if (results.length === 0) return <Empty what="keywords" />;
  return (
    <ul className="rules-ref-list" role="list">
      {results.map((k) => {
        const isOpen = expanded === k.name;
        const summary = glossaryByTerm.get(k.name.toLowerCase());
        return (
          <li key={`${k.kind}-${k.rule}`} className="rules-ref-keyword">
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
            {summary && !isOpen && <p className="rules-ref-keyword-summary">{summary}</p>}
            {isOpen && (
              <div className="rules-ref-keyword-body">
                {subrulesFor(bundle.rules, k.rule).map((r) => (
                  <p key={r.number} className="rules-ref-rule">
                    <span className="rules-ref-rule-num">{r.number}</span>
                    <span className="rules-ref-rule-text">{withRuleLinks(r.text, onJump)}</span>
                  </p>
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
}: {
  bundle: RulesBundle;
  query: string;
  onJump: (n: string) => void;
}) {
  // ponytail: renders all ~720 terms unfiltered; plain rows so it's fine. Add
  // virtualization if the glossary ever balloons.
  const results = useMemo(() => searchGlossary(bundle.glossary, query), [bundle, query]);
  if (results.length === 0) return <Empty what="terms" />;
  return (
    <dl className="rules-ref-glossary">
      {results.map((g) => (
        <div key={g.term} className="rules-ref-glossary-entry">
          <dt className="rules-ref-glossary-term">{g.term}</dt>
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
}: {
  bundle: RulesBundle;
  query: string;
  onJump: (n: string) => void;
}) {
  const LIMIT = 200;
  const results = useMemo(() => searchRules(bundle.rules, query, LIMIT), [bundle, query]);
  if (results.length === 0) return <Empty what="rules" />;
  return (
    <div className="rules-ref-rules">
      {results.map((r) => (
        <p key={r.number} className="rules-ref-rule">
          <span className="rules-ref-rule-num">{r.number}</span>
          <span className="rules-ref-rule-text">{withRuleLinks(r.text, onJump)}</span>
        </p>
      ))}
      {results.length >= LIMIT && (
        <p className="rules-ref-status">Showing the first {LIMIT} matches — refine your search.</p>
      )}
    </div>
  );
}

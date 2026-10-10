import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/app-shell/BackLink';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { WALKTHROUGH_GROUPS } from '@/lib/rules-walkthroughs';
import { ICON_SCALE } from '@/lib/util/icon-scale';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import './RulesWalkthroughs.css';

/**
 * `/rules/walkthroughs` — the index of rules walkthroughs (board E357): each
 * steps through one interaction on the stack, with the rules behind every
 * step. Grouped in reading order; the basics come first.
 */
export function RulesWalkthroughsPage() {
  useDocumentTitle('Walkthroughs');
  return (
    <div className="rules-wt-page">
      <BackLink to="/rules" label="Rules" />
      <PageHeader
        title="Walkthroughs"
        meta="Step through how the stack resolves, one event at a time."
      />
      {WALKTHROUGH_GROUPS.map((group, g) => (
        <section
          key={group.title}
          className="rules-wt-group"
          aria-labelledby={`rules-wt-group-${g}`}
        >
          <SectionHeader title={group.title} id={`rules-wt-group-${g}`} variant="overline" />
          <ul className="rules-wt-list" role="list">
            {group.walkthroughs.map((w) => (
              <li key={w.id}>
                <Link to={`/rules/walkthroughs/${w.id}`} className="rules-wt-row">
                  <span className="rules-wt-row-text">
                    <span className="rules-wt-row-title">{w.title}</span>
                    <span className="rules-wt-row-summary">{w.summary}</span>
                  </span>
                  <span className="rules-wt-row-steps">{w.steps.length} steps</span>
                  <ChevronRight
                    className="rules-wt-row-chevron"
                    aria-hidden
                    width={ICON_SCALE.standalone.size}
                    height={ICON_SCALE.standalone.size}
                    strokeWidth={ICON_SCALE.standalone.stroke}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

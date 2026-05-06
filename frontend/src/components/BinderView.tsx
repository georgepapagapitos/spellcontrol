import { useCollectionStore } from '../store/collection';
import { COLOR_INFO } from '../lib/colors';
import type { BinderSection, MaterializedBinder, PocketSize, UncategorizedBucket } from '../types';
import { PageGrid } from './PageGrid';

interface Props {
  binders: MaterializedBinder[];
  uncategorized: UncategorizedBucket;
}

export function BinderView({ binders, uncategorized }: Props) {
  const { activeTab, setEditingBinder } = useCollectionStore();

  if (activeTab === 'uncategorized') {
    if (uncategorized.totalCards === 0) {
      return (
        <div className="empty-state">🎉 Every card has a binder. Nothing left to categorize.</div>
      );
    }
    return (
      <>
        <div className="binder-intro">
          <p style={{ color: 'var(--text2)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            These cards didn't match any binder rule. Create a new binder or tweak existing rules to
            whittle this down.
          </p>
        </div>
        <SectionList
          sections={uncategorized.sections}
          pocketSize={uncategorized.effectivePocketSize}
        />
      </>
    );
  }

  const active = binders.find((b) => b.def.id === activeTab);
  if (!active) {
    return (
      <div className="empty-state">
        Select a binder above, or click <strong>+ New binder</strong> to create one.
      </div>
    );
  }

  if (active.totalCards === 0) {
    return (
      <div className="empty-state">
        No cards match this binder's rules.{' '}
        <button
          className="btn"
          style={{ marginLeft: 8 }}
          onClick={() => setEditingBinder(active.def.id)}
        >
          Edit rules
        </button>
      </div>
    );
  }

  return <SectionList sections={active.sections} pocketSize={active.effectivePocketSize} />;
}

function SectionList({
  sections,
  pocketSize,
}: {
  sections: BinderSection[];
  pocketSize: PocketSize;
}) {
  return (
    <>
      {sections.map((section) => {
        const info = COLOR_INFO[section.colorKey] || {
          label: section.colorKey,
          pip: '#eee',
          border: '#aaa',
          order: 99,
        };
        return (
          <div key={section.colorKey} className="binder-section">
            <div className="section-header">
              <div
                className="color-pip"
                style={{ background: info.pip, borderColor: info.border }}
              />
              <span className="section-title">{info.label}</span>
              <span className="section-meta">
                {section.cards.length} cards · {section.pages.length} physical page
                {section.pages.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="page-row">
              {section.pages.map((page) => (
                <PageGrid
                  key={page.pageNum}
                  page={page.slots}
                  pageNum={page.pageNum}
                  pocketSize={pocketSize}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

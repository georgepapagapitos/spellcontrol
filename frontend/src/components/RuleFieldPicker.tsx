import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPanel } from '@/lib/use-anchored-panel';
import { searchFilterFields, type FilterFieldId } from '../lib/filter-fields';

interface Props {
  /** Fields already showing a row in this group — hidden from the list. */
  inUse: ReadonlySet<FilterFieldId>;
  onPick: (id: FilterFieldId) => void;
}

/**
 * "Add rule" — a searchable, grouped picker over the 22 filter fields.
 *
 * It replaces a "More rules" disclosure triangle that hid seventeen of them
 * behind one word, in a fixed order, with a single dot as the only clue that
 * anything down there was set. Finding "the one about foils" meant expanding
 * and reading every label.
 *
 * Search covers each field's label, its hint and a keyword list, so "cmc"
 * finds Mana value, "foil" finds Finish, and "staple" finds EDHREC popularity.
 * The four type predicates — Type line, Supertype, Card type, Subtype — sit
 * adjacent under Identity with a hint apiece, because their names alone have
 * never been enough to tell them apart at the moment you have to choose.
 */
export function RuleFieldPicker({ inUse, onPick }: Props) {
  const { open, toggle, close, triggerRef, panelRef, panelStyle } = useAnchoredPanel({
    align: 'left',
  });
  const [query, setQuery] = useState('');

  // Reset on the way IN rather than in an effect keyed on `open` — a stale
  // filter from last time reads as "this picker only has two fields in it",
  // and setState-in-effect is a cascading render the lint rule rightly blocks.
  // Focus needs no effect either: the search input is the panel's first
  // focusable, and `useAnchoredPanel` already moves focus into the panel.
  const openPicker = () => {
    if (!open) setQuery('');
    toggle();
  };

  const sections = searchFilterFields(query, inUse);

  return (
    <div className="rule-field-picker">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-add-rule"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPicker}
      >
        <Plus width={14} height={14} strokeWidth={2} aria-hidden />
        Add rule
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="rule-field-panel"
            role="dialog"
            aria-label="Add a rule"
            style={panelStyle}
          >
            <div className="rule-field-search">
              <Search width={14} height={14} strokeWidth={2} aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search rules…"
                aria-label="Search rules"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter on a single remaining match adds it — the fast path
                  // once you know the name of the field you want.
                  if (e.key !== 'Enter') return;
                  const only = sections.length === 1 && sections[0].fields.length === 1;
                  if (!only) return;
                  e.preventDefault();
                  onPick(sections[0].fields[0].id);
                  close();
                }}
              />
            </div>
            <div className="rule-field-list">
              {sections.length === 0 && (
                <p className="rule-field-empty">
                  {inUse.size > 0
                    ? `No rule matches “${query.trim()}”. Every other rule is already in this group.`
                    : `No rule matches “${query.trim()}”.`}
                </p>
              )}
              {sections.map(({ group, fields }) => (
                <section key={group} className="rule-field-section">
                  <h4 className="rule-field-section-label">{group}</h4>
                  {fields.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      className="rule-field-option"
                      onClick={() => {
                        onPick(spec.id);
                        close();
                      }}
                    >
                      <span className="rule-field-option-label">{spec.label}</span>
                      {spec.hint && <span className="rule-field-option-hint">{spec.hint}</span>}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

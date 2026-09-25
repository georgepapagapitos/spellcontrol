import { useId, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import {
  COUNTER_CATALOG,
  counterColor,
  counterGlyph,
  counterLabel,
  sortCounters,
} from '../lib/counter-kinds';
import './CustomCountersDialog.css';

interface Props {
  cardName: string;
  counters: Record<string, number>;
  /** The change to each kind, by how many to add (negative takes off). Only
   *  kinds that changed are present. */
  onApply(deltas: Record<string, number>): void;
  onClose(): void;
}

const MAX_NAME = 20;

/**
 * EDHPlay's Custom Counters dialog: pick a printed counter from a searchable
 * list, or name your own, then set every count on the card and apply them in
 * one go. Nothing reaches the board until Apply, so a slip in a count box is
 * never a move the table sees.
 */
export function CustomCountersDialog({ cardName, counters, onApply, onClose }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<Array<[string, number]>>(() => sortCounters(counters));
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [name, setName] = useState('');

  const q = query.trim().toLowerCase();
  const options = COUNTER_CATALOG.filter((c) => c.kind.includes(q));
  const listId = `${id}-list`;

  /** One more of `kind`: a new row at 1, or the row it already has, +1. */
  function add(kind: string) {
    setDraft((d) =>
      d.some(([k]) => k === kind)
        ? d.map(([k, n]) => [k, k === kind ? n + 1 : n])
        : [...d, [kind, 1]]
    );
  }

  function choose(kind: string) {
    add(kind);
    setQuery('');
    setListOpen(false);
  }

  function addNamed() {
    const typed = name.trim().slice(0, MAX_NAME);
    if (!typed) return;
    // "Charge" typed by hand is the printed charge counter, not a new one.
    add(counterGlyph(typed.toLowerCase()) ? typed.toLowerCase() : typed);
    setName('');
  }

  const deltas: Record<string, number> = {};
  for (const kind of new Set([...Object.keys(counters), ...draft.map(([k]) => k)])) {
    const next = draft.find(([k]) => k === kind)?.[1] ?? 0;
    const delta = next - (counters[kind] ?? 0);
    if (delta !== 0) deltas[kind] = delta;
  }
  const changed = Object.keys(deltas).length > 0;

  return (
    <Modal
      onClose={onClose}
      labelledBy={`${id}-title`}
      className="modal counters-dialog"
      // A picker, so a bottom sheet on phones that grows only as tall as its
      // content (STYLE_GUIDE, Pattern B), not a full-height page of empty space.
      backdropClassName="modal-backdrop--sheet"
    >
      <header className="modal-header">
        <h2 id={`${id}-title`}>Custom counters</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="modal-body counters-dialog__body">
        <p className="counters-dialog__card">{cardName}</p>

        <label className="counters-dialog__label" htmlFor={`${id}-search`}>
          Printed counters
        </label>
        <div className="counters-dialog__combo">
          <div className="counters-dialog__row">
            <input
              id={`${id}-search`}
              className="counters-dialog__input"
              type="text"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                listOpen && options[active] ? `${id}-opt-${active}` : undefined
              }
              placeholder="Search counters…"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setListOpen(true);
              }}
              onFocus={() => setListOpen(true)}
              onBlur={() => setListOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (!listOpen) return setListOpen(true);
                  const step = e.key === 'ArrowDown' ? 1 : -1;
                  setActive((a) => (a + step + options.length) % Math.max(options.length, 1));
                } else if (e.key === 'Enter' && listOpen && options[active]) {
                  e.preventDefault();
                  choose(options[active].kind);
                } else if (e.key === 'Escape' && listOpen) {
                  // Closes the list, not the dialog.
                  e.stopPropagation();
                  setListOpen(false);
                }
              }}
            />
            <button
              type="button"
              className="counters-dialog__icon-btn"
              aria-label={listOpen ? 'Hide the list' : 'Show every printed counter'}
              aria-controls={listId}
              aria-expanded={listOpen}
              // Keep focus in the field, so the list it opens stays open.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setListOpen((o) => !o)}
            >
              <ChevronDown width={18} height={18} aria-hidden />
            </button>
          </div>
          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              className="counters-dialog__list"
              aria-label="Printed counters"
            >
              {options.length === 0 && (
                <li className="counters-dialog__none" role="presentation">
                  No printed counter matches. Name it below instead.
                </li>
              )}
              {options.map((c, i) => (
                <li
                  key={c.kind}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`counters-dialog__option${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  // Picked on mousedown, as in CommanderTypeahead: the field keeps focus
                  // and the keyboard drives the same list through aria-activedescendant.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c.kind);
                  }}
                >
                  <i className={`ms ${c.glyph}`} aria-hidden />
                  {counterLabel(c.kind)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="counters-dialog__label" htmlFor={`${id}-name`}>
          Your own
        </label>
        <div className="counters-dialog__row">
          <input
            id={`${id}-name`}
            className="counters-dialog__input"
            type="text"
            placeholder="Name a counter"
            maxLength={MAX_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addNamed();
              }
            }}
          />
          <button
            type="button"
            className="counters-dialog__icon-btn counters-dialog__add"
            aria-label="Add this counter"
            disabled={!name.trim()}
            onClick={addNamed}
          >
            <Plus width={18} height={18} aria-hidden />
          </button>
        </div>

        <h3 className="counters-dialog__label">On this card</h3>
        {draft.length === 0 ? (
          <p className="counters-dialog__empty">No counters yet.</p>
        ) : (
          <ul className="counters-dialog__active" role="list">
            {draft.map(([kind, n]) => {
              const glyph = counterGlyph(kind);
              const label = counterLabel(kind);
              return (
                <li key={kind} className="counters-dialog__counter">
                  <span
                    className={`counters-dialog__swatch${glyph ? ' is-mark' : ''}`}
                    style={glyph ? undefined : { background: counterColor(kind) }}
                    aria-hidden
                  >
                    {glyph && <i className={`ms ${glyph}`} />}
                  </span>
                  <span className="counters-dialog__name">{label}</span>
                  <input
                    className="counters-dialog__count"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`${label} count`}
                    value={n}
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setDraft((d) => d.map(([k, c]) => [k, k === kind ? v : c]));
                    }}
                  />
                  <button
                    type="button"
                    className="counters-dialog__icon-btn"
                    aria-label={`Remove ${label}`}
                    onClick={() => setDraft((d) => d.filter(([k]) => k !== kind))}
                  >
                    <Trash2 width={16} height={16} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="choice-dialog-actions counters-dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!changed}
          onClick={() => onApply(deltas)}
        >
          Apply changes
        </button>
      </div>
    </Modal>
  );
}

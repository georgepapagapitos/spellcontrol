import type { CollectionStrategy, Customization } from '@/deck-builder/types';
import { Field, ChoiceList, SegmentedControl } from '../shared/form';
import { useCollectionStore } from '../../store/collection';

export interface CollectionGroupProps {
  customization: Customization;
  update: (patch: Partial<Customization>) => void;
}

/** The full "Use my collection" control: the switch, the strategy and the owned-share slider. */
export function CollectionGroup({ customization, update }: CollectionGroupProps) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const uniqueCount = new Set(collectionCards.map((c) => c.name)).size;
  const active = customization.collectionMode;
  const empty = uniqueCount === 0;
  const strategy = customization.collectionStrategy;
  const pct = customization.collectionOwnedPercent;
  const sub = empty
    ? 'Import cards on the Collection page to enable this.'
    : active
      ? strategy === 'partial'
        ? `Aims for about ${pct}% owned.`
        : strategy === 'available'
          ? 'Uses only copies not committed to other decks.'
          : strategy === 'prefer'
            ? 'Leans on copies not committed to other decks.'
            : strategy === 'exclude'
              ? 'Leaves out every card you own, except basic lands and your must-includes.'
              : 'Uses only cards you own.'
      : 'Build from the cards you own, or leave them out.';
  return (
    <div className={`deck-customizer-group collection-group${active ? ' active' : ''}`}>
      <label className="collection-group-row">
        <input
          type="checkbox"
          className="collection-group-checkbox"
          checked={active}
          disabled={empty}
          // Explicit aria-label: the implicit <label> wrapping would
          // otherwise concatenate the sub-description text below into the
          // accessible name too, which reads as a run-on to a screen reader
          // (same pattern as ManaPhilosophyGroup below).
          aria-label="Use my collection"
          onChange={(e) => update({ collectionMode: e.target.checked })}
        />
        <span className="collection-group-text">
          <span className="row-between row-between--snug">
            <span className="collection-group-title">Use my collection</span>
            <span className="collection-group-badge" aria-hidden>
              {uniqueCount.toLocaleString()} unique
            </span>
          </span>
          <span className="collection-group-sub">{sub}</span>
        </span>
      </label>

      {active && (
        <div className="collection-group-controls">
          <Field label="Collection strategy">
            <ChoiceList<CollectionStrategy>
              ariaLabel="Collection strategy"
              value={strategy}
              options={[
                { value: 'prefer', label: 'Lean on mine', hint: 'Owned-first' },
                { value: 'full', label: 'Only my cards', hint: 'Owned only' },
                { value: 'partial', label: 'Owned share %', hint: 'Target %' },
                { value: 'available', label: 'Available only', hint: 'Free copies' },
                { value: 'exclude', label: 'Skip my cards', hint: 'None owned' },
              ]}
              onChange={(v) => update({ collectionStrategy: v })}
            />
          </Field>

          {strategy === 'partial' && (
            <div className="deck-customizer-slider">
              <div className="deck-customizer-slider-header">
                <span className="deck-customizer-slider-label">Target owned</span>
                <span className="deck-customizer-slider-value">{pct}%</span>
              </div>
              <input
                type="range"
                className="deck-customizer-range"
                min={25}
                max={100}
                step={5}
                value={pct}
                aria-label="Target owned percent"
                onChange={(e) => update({ collectionOwnedPercent: Number(e.target.value) })}
                style={{
                  ['--range-progress' as string]: `${((pct - 25) / 75) * 100}%`,
                }}
              />
              <div className="deck-customizer-slider-anchors">
                <span className="deck-customizer-slider-anchor" data-align="start">
                  <span className="deck-customizer-slider-anchor-label">25%</span>
                </span>
                <span className="deck-customizer-slider-anchor" data-align="end">
                  <span className="deck-customizer-slider-anchor-label">100%</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type CardsFrom = 'any' | 'mine-first' | 'only-mine' | 'custom';

/**
 * Where the cards come from, in three words (E1113): any card, mine first, only mine. Only
 * mine means free copies ('available'): a physical deck can't use a copy another deck holds.
 * The other strategies (every owned copy, a share, skip mine) live in the full control under
 * More settings; while one is set this reads "Set under More settings" instead of lying.
 */
export function CardsFromGroup({ customization, update }: CollectionGroupProps) {
  const empty = useCollectionStore((s) => s.cards.length === 0);
  const { collectionMode, collectionStrategy } = customization;
  const value: CardsFrom = !collectionMode
    ? 'any'
    : collectionStrategy === 'prefer'
      ? 'mine-first'
      : collectionStrategy === 'available'
        ? 'only-mine'
        : 'custom';
  const options: Array<{ value: CardsFrom; label: string; hint: string }> = [
    { value: 'any', label: 'Any card', hint: 'Ignore my collection' },
    { value: 'mine-first', label: 'Mine first', hint: 'Free owned cards first' },
    { value: 'only-mine', label: 'Only mine', hint: 'Owned cards no other deck uses' },
    ...(value === 'custom'
      ? [{ value: 'custom' as const, label: 'Custom', hint: 'Set under More settings' }]
      : []),
  ];
  return (
    <div className="deck-customizer-group">
      <div className="deck-customizer-group-header">
        <h3 className="deck-customizer-group-title">Cards from</h3>
      </div>
      <div className="deck-customizer-group-body">
        <SegmentedControl<CardsFrom>
          ariaLabel="Cards from"
          value={value}
          options={(empty ? options.filter((o) => o.value === 'any') : options).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
          onChange={(v) => {
            if (v === 'custom') return;
            update(
              v === 'any'
                ? { collectionMode: false }
                : {
                    collectionMode: true,
                    collectionStrategy: v === 'only-mine' ? 'available' : 'prefer',
                  }
            );
          }}
        />
        <p className="deck-customizer-hint">{options.find((o) => o.value === value)?.hint}</p>
        {empty && (
          <p className="deck-customizer-hint">Import cards on the Collection page to use them.</p>
        )}
      </div>
    </div>
  );
}

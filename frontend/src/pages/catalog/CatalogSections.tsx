/**
 * The catalog's specimens: every shared primitive in every meaningful state.
 * Each `<Specimen>` is one screenshot crop for `scripts/catalog-shots.mjs`
 * (keyed on `data-catalog-section`), so a section is sized to be readable as
 * an image and named so a diff points at the primitive that moved.
 *
 * NO NETWORK: every card here carries its own art (an inline SVG data URI),
 * so `useCardThumb`'s name lookup never fires and the crops are stable.
 */
import { useState, type ReactNode } from 'react';
import { Copy, Plus, Search, Trash2 } from 'lucide-react';
import { Button, IconButton, type ButtonVariant } from '@/components/shared/Button';
import { Chip, type Tone } from '@/components/shared/Chip';
import { Count } from '@/components/shared/Count';
import { Surface } from '@/components/shared/Surface';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { SectionHeaderBar } from '@/components/shared/SectionHeaderBar';
import { ArtBadge } from '@/components/shared/ArtBadge';
import { MeterBar, StackedBar } from '@/components/shared/MeterBar';
import { ColorPip, ManaSymbol, TypeIcon } from '@/components/shared/ManaSymbol';
import { ColorIdentityBar } from '@/components/shared/ColorIdentityBar';
import { ColorIdentityPicker } from '@/components/shared/ColorIdentityPicker';
import { ColorMatchModeToggle } from '@/components/shared/ColorMatchModeToggle';
import {
  ChoiceList,
  Disclosure,
  Field,
  SegmentedControl,
  SwitchRow,
} from '@/components/shared/form';
import { EmptyState } from '@/components/shared/EmptyState';
import { RarityBadge } from '@/components/shared/RarityBadge';
import { SetSymbol } from '@/components/shared/SetSymbol';
import { ProxyBadge } from '@/components/shared/ProxyBadge';
import { PriceOverrideBadge } from '@/components/shared/PriceOverrideBadge';
import { ThinDataNote } from '@/components/shared/ThinDataNote';
import { FilterChipsRow } from '@/components/shared/FilterChipsRow';
import { CopyButton, CopyIconButton } from '@/components/shared/CopyButton';
import { CardName } from '@/components/shared/CardName';
import { CardRow, ConditionChip } from '@/components/shared/CardRow';
import { CardGridCell } from '@/components/shared/CardGridCell';
import { SwipeRow } from '@/components/shared/SwipeRow';
import { Tabs } from '@/components/Tabs';
import { SelectMenu } from '@/components/SelectMenu';
import { OverflowMenu } from '@/components/OverflowMenu';
import type { EnrichedCard } from '@/types';

const noop = () => {};
const TONES: Tone[] = ['neutral', 'accent', 'success', 'info', 'warn', 'err'];
const VARIANTS: ButtonVariant[] = ['secondary', 'primary', 'danger', 'link'];

/** Inline card art: a deterministic gradient plate, so no request is made. */
function art(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${hue + 50} 60% 22%)"/></linearGradient></defs><rect width="488" height="680" rx="26" fill="#111"/><rect x="22" y="22" width="444" height="636" rx="14" fill="url(#g)"/><rect x="44" y="52" width="400" height="44" rx="8" fill="#0006"/><rect x="44" y="112" width="400" height="300" rx="8" fill="#ffffff26"/><rect x="44" y="440" width="400" height="150" rx="8" fill="#0005"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A static fixture card. Never a real printing: only its shape matters. */
function fixtureCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'catalog-1',
    name: 'Catalog Specimen',
    setCode: 'MKM',
    setName: 'Murders at Karlov Manor',
    collectorNumber: '167',
    rarity: 'rare',
    scryfallId: 'catalog-sf-1',
    purchasePrice: 1.25,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Creature',
    manaCost: '{3}{G}',
    imageSmall: art(140),
    imageNormal: art(140),
    ...overrides,
  };
}

function Specimen({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="catalog-section" data-catalog-section={id} aria-labelledby={`cat-${id}`}>
      <h2 id={`cat-${id}`} className="catalog-section-title">
        {title}
      </h2>
      <div className="catalog-specimen">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="catalog-row">
      <span className="catalog-row-label">{label}</span>
      <div className="catalog-row-body">{children}</div>
    </div>
  );
}

function ButtonSpecimen() {
  const icon = <Plus width={14} height={14} strokeWidth={1.8} />;
  const placements = [
    ['inline', VARIANTS],
    ['row', VARIANTS.filter((v) => v !== 'link')],
    ['toolbar', ['secondary', 'danger'] as ButtonVariant[]],
  ] as const;
  return (
    <Specimen id="button" title="Button and IconButton">
      {placements.map(([placement, variants]) => (
        <Row key={placement} label={placement}>
          {variants.map((variant) => (
            <Button
              key={variant}
              // The union in Button's props is per-placement; the table above
              // only lists the pairs each placement allows.
              {...({ placement, variant } as { placement: 'inline'; variant: ButtonVariant })}
              onClick={noop}
            >
              {variant}
            </Button>
          ))}
          <Button
            {...({ placement, variant: 'secondary' } as { placement: 'inline' })}
            icon={icon}
            onClick={noop}
          >
            icon
          </Button>
          <Button
            {...({ placement, variant: 'secondary' } as { placement: 'inline' })}
            iconEnd={<Search width={14} height={14} strokeWidth={1.8} />}
            onClick={noop}
          >
            iconEnd
          </Button>
          <Button
            {...({ placement, variant: 'secondary' } as { placement: 'inline' })}
            disabled
            onClick={noop}
          >
            disabled
          </Button>
        </Row>
      ))}
      <Row label="as link">
        <Button to="/dev/catalog" variant="primary">
          router link
        </Button>
        <Button href="#catalog-top" variant="link">
          anchor
        </Button>
      </Row>
      <Row label="IconButton">
        {/* No variant-less IconButton here: without a variant it carries no
            shared class, and each caller's own class gives it its look. */}
        <IconButton label="Quiet" variant="quiet" icon={<Search width={16} height={16} />} />
        <IconButton label="Row" placement="row" variant="secondary" icon={icon} onClick={noop} />
        <IconButton
          label="Danger"
          placement="row"
          variant="danger"
          icon={<Trash2 width={14} height={14} strokeWidth={1.8} />}
        />
        <IconButton label="Disabled" variant="quiet" icon={icon} disabled />
      </Row>
      <Row label="CopyButton">
        <CopyButton value="catalog" what="Catalog" />
        <CopyIconButton
          value="catalog"
          what="Catalog"
          label="Copy"
          className="icon-btn"
          icon={<Copy width={14} height={14} strokeWidth={1.8} />}
        />
      </Row>
    </Specimen>
  );
}

function ChipSpecimen() {
  const [pressed, setPressed] = useState(true);
  return (
    <Specimen id="chip" title="Chip, Count and ArtBadge">
      <Row label="label, every tone">
        {TONES.map((tone) => (
          <Chip key={tone} className="deck-format-badge" tone={tone}>
            {tone}
          </Chip>
        ))}
        <Chip className="deck-format-badge" tone="accent" icon={<Plus width={12} height={12} />}>
          with icon
        </Chip>
      </Row>
      <Row label="filter">
        <Chip className="filter-chip" pressed={pressed} onClick={() => setPressed((p) => !p)}>
          Pressed
        </Chip>
        <Chip className="filter-chip" pressed={false} onClick={noop}>
          Unpressed
        </Chip>
      </Row>
      <Row label="action">
        <Chip className="filter-chip" onClick={noop}>
          Action
        </Chip>
      </Row>
      <Row label="removable">
        <Chip
          className="collection-filter-chip"
          labelClassName="collection-filter-chip-label"
          removeClassName="collection-filter-chip-clear"
          removeLabel="Remove Rare"
          onRemove={noop}
        >
          Rare
        </Chip>
      </Row>
      <Row label="Count">
        <span className="catalog-count-host">
          Inline
          <Count className="catalog-count" value={7} placement="inline" />
        </span>
        <span className="catalog-count-host">
          Accent
          <Count className="catalog-count" value={12} placement="inline" tone="accent" />
        </span>
        <span className="catalog-count-host catalog-count-host--corner">
          Corner
          <Count className="catalog-count" value={3} placement="corner" />
        </span>
      </Row>
      <Row label="ArtBadge">
        <div className="catalog-art-tile" style={{ backgroundImage: `url("${art(210)}")` }}>
          <ArtBadge className="catalog-art-badge" corner="top-start">
            x2
          </ArtBadge>
          <ArtBadge className="catalog-art-badge" corner="top-end" tone="warn">
            Foil
          </ArtBadge>
          <ArtBadge
            className="catalog-art-badge"
            corner="bottom-start"
            tone="success"
            icon={<Plus width={12} height={12} />}
            label="Added"
          />
          <ArtBadge className="catalog-art-badge" corner="bottom-end" tone="err">
            Out
          </ArtBadge>
        </div>
      </Row>
    </Specimen>
  );
}

function SurfaceSpecimen() {
  return (
    <Specimen id="surface" title="Surface and SectionHeader">
      <div className="catalog-surfaces">
        {(['sleeve', 'framed', 'popover'] as const).map((variant) => (
          <Surface key={variant} variant={variant} className="catalog-surface">
            {variant}
          </Surface>
        ))}
      </div>
      <SectionHeader title="Title, no extras" />
      <SectionHeader variant="overline" level={3} title="Overline, no extras" />
      <SectionHeader
        as="header"
        className="catalog-section-head"
        title="Title with meta and tools"
        meta={<span className="catalog-muted">24 cards</span>}
        tools={
          <Button placement="row" variant="secondary" onClick={noop}>
            Tool
          </Button>
        }
      />
      <SectionHeader
        as="header"
        className="catalog-section-head"
        variant="overline"
        level={3}
        leading={<ColorPip color="G" pip />}
        title="Leading and titleAfter"
        titleAfter={<Count className="catalog-count" value={5} placement="inline" />}
      />
      <SectionHeaderBar
        className="collection-grid-section-header"
        label="Creatures"
        count={14}
        collapsed={false}
        onToggle={noop}
        meta={<span className="catalog-muted">$32.10</span>}
      />
      <SectionHeaderBar
        className="collection-grid-section-header"
        label="Lands"
        count={36}
        collapsed
        onToggle={noop}
      />
    </Specimen>
  );
}

function MeterSpecimen() {
  return (
    <Specimen id="meter" title="MeterBar and StackedBar">
      {(['sm', 'md'] as const).map((size) => (
        <Row key={size} label={size}>
          <div className="catalog-bar">
            <MeterBar value={0} size={size} />
            <MeterBar value={35} size={size} />
            <MeterBar value={72} size={size} tick={50} />
            <MeterBar value={100} size={size} color="var(--success)" />
            <MeterBar value={2} minPct={4} size={size} />
            <MeterBar value={40} size={size} indeterminate />
          </div>
        </Row>
      ))}
      <Row label="stacked">
        <div className="catalog-bar">
          <StackedBar
            segments={[
              { key: 'a', value: 40, color: 'var(--accent)' },
              { key: 'b', value: 25, color: 'var(--success)' },
              { key: 'c', value: 10, color: 'var(--warn)' },
            ]}
            max={100}
          />
          <StackedBar
            size="md"
            segments={[
              { key: 'a', value: 30, color: 'var(--accent)' },
              { key: 'b', value: 30, color: 'var(--err)' },
            ]}
            max={100}
          />
        </div>
      </Row>
    </Specimen>
  );
}

function SymbolSpecimen() {
  return (
    <Specimen id="symbols" title="ManaSymbol, ColorPip, TypeIcon, SetSymbol, RarityBadge">
      <Row label="ColorPip">
        {['W', 'U', 'B', 'R', 'G', 'C'].map((c) => (
          <ColorPip key={c} color={c} pip label={c} />
        ))}
      </Row>
      <Row label="pip md / lg">
        <ColorPip color="R" pip="md" label="R" />
        <ColorPip color="U" pip="lg" label="U" />
      </Row>
      <Row label="ManaSymbol cost">
        {['w', '2', 'x', 'wu', 'tap', 'e'].map((s) => (
          <ManaSymbol key={s} symbol={s} cost label={s} />
        ))}
        <ManaSymbol symbol="2w" cost split label="2w" />
      </Row>
      <Row label="TypeIcon">
        {['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'planeswalker'].map(
          (t) => (
            <TypeIcon key={t} type={t} label={t} />
          )
        )}
      </Row>
      <Row label="ColorIdentityBar">
        <span className="catalog-colorbar">
          <ColorIdentityBar colors={['W', 'U']} />
        </span>
        <span className="catalog-colorbar">
          <ColorIdentityBar colors={['B', 'R', 'G']} />
        </span>
        <span className="catalog-colorbar">
          <ColorIdentityBar colors={[]} />
        </span>
      </Row>
      <Row label="SetSymbol">
        {['common', 'uncommon', 'rare', 'mythic'].map((r) => (
          <SetSymbol key={r} setCode="mkm" rarity={r} title={r} />
        ))}
      </Row>
      <Row label="RarityBadge">
        {['common', 'uncommon', 'rare', 'mythic'].map((r) => (
          <RarityBadge key={r} rarity={r} />
        ))}
      </Row>
      <Row label="ProxyBadge">
        <ProxyBadge card={{ proxy: true }} />
        <PriceOverrideBadge card={{ priceOverride: 25, priceOverrideCurrency: 'USD' }} />
        <ConditionChip condition="lp" />
      </Row>
      <Row label="CardName">
        <CardName card={fixtureCard()} />
      </Row>
    </Specimen>
  );
}

function FormSpecimen() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('b');
  const [choice, setChoice] = useState<'one' | 'two'>('one');
  return (
    <Specimen id="form" title="Field, SwitchRow, SegmentedControl, ChoiceList, Disclosure">
      <div className="catalog-form">
        <Field label="Deck name" hint="A hint that is always visible." htmlFor="catalog-name">
          <input id="catalog-name" className="catalog-input" defaultValue="Catalog deck" />
        </Field>
        <SwitchRow
          label="Show prices"
          hint="On shows a price on every row."
          checked={on}
          onChange={setOn}
        />
        <SwitchRow label="Disabled switch" checked={false} onChange={noop} disabled />
        <SegmentedControl
          ariaLabel="Density"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'a', label: 'Compact' },
            { value: 'b', label: 'Regular' },
            { value: 'c', label: 'Roomy' },
          ]}
        />
        <SegmentedControl
          ariaLabel="Filled"
          fill
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'a', label: 'One' },
            { value: 'b', label: 'Two', disabled: true },
            { value: 'c', label: 'Three' },
          ]}
        />
        <ChoiceList
          ariaLabel="Mode"
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'one', label: 'First choice', hint: 'What the first choice does.' },
            { value: 'two', label: 'Second choice', hint: 'What the second choice does.' },
          ]}
        />
        <Disclosure title="Advanced" summary="Defaults">
          <p className="catalog-muted">Hidden until opened.</p>
        </Disclosure>
        <Disclosure title="Advanced, open" summary="Defaults" defaultOpen>
          <p className="catalog-muted">Shown from the start.</p>
        </Disclosure>
      </div>
    </Specimen>
  );
}

function NavSpecimen() {
  const [tab, setTab] = useState('one');
  const [sel, setSel] = useState('recent');
  const tabs = [
    { id: 'one', label: 'Overview' },
    { id: 'two', label: 'Cards', count: 99 },
    {
      id: 'three',
      label: 'Combos',
      badge: { text: 'New', description: 'New combos', tone: 'success' as const },
    },
  ];
  return (
    <Specimen id="nav" title="Tabs, SelectMenu, ColorIdentityPicker">
      {(['fitted', 'scrollable', 'underline'] as const).map((variant) => (
        <Tabs
          key={variant}
          ariaLabel={`${variant} tabs`}
          variant={variant}
          tabs={tabs}
          value={tab}
          onChange={setTab}
        />
      ))}
      <Row label="SelectMenu">
        <SelectMenu
          ariaLabel="Sort"
          label="Sort"
          value={sel}
          onChange={setSel}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'name', label: 'Name' },
          ]}
        />
        <SelectMenu
          ariaLabel="Disabled sort"
          value="recent"
          onChange={noop}
          disabled
          options={[{ value: 'recent', label: 'Recent' }]}
        />
      </Row>
      <Row label="Color picker">
        <ColorIdentityPicker colors={new Set(['W', 'U'])} onChange={noop} />
        <ColorMatchModeToggle mode="any" onChange={noop} />
      </Row>
    </Specimen>
  );
}

function StateSpecimen() {
  return (
    <Specimen id="states" title="EmptyState, FilterChipsRow, ThinDataNote">
      <EmptyState tagline="No decks yet." hint="Build one and it appears here." />
      <EmptyState
        tagline="Nothing matches."
        hint="Clear a filter to see more."
        actions={
          <Button variant="primary" onClick={noop}>
            Clear filters
          </Button>
        }
      />
      <EmptyState compact className="catalog-muted">
        One quiet line.
      </EmptyState>
      <FilterChipsRow
        chips={[
          { id: 'a', label: 'Rarity: rare', onClear: noop },
          { id: 'b', label: 'Colour: green', onClear: noop },
        ]}
        onClearAll={noop}
      />
      <ThinDataNote sampleSize={12} />
    </Specimen>
  );
}

function CardSpecimen() {
  const base = {
    qty: 2,
    allocations: [],
    // The real row menu (a closed OverflowMenu trigger), so the crop shows the
    // kebab every card row carries.
    menu: <OverflowMenu ariaLabel="Card actions" items={[{ label: 'Edit', onClick: noop }]} />,
    onActivate: noop,
  };
  return (
    <Specimen id="cards" title="CardRow, CardGridCell, SwipeRow">
      <>
        <div className="catalog-card-rows">
          <CardRow card={fixtureCard()} {...base} />
          <CardRow card={fixtureCard({ condition: 'lp', proxy: true })} {...base} qty={1} />
          <CardRow
            card={fixtureCard({ priceOverride: 25, foil: true })}
            {...base}
            selectMode
            selected
            isLastRow
          />
        </div>
        <div className="catalog-card-grid">
          {(['1x', '2x', '3x'] as const).map((size) => (
            <div key={size} className={`catalog-grid-cell catalog-grid-cell--${size}`}>
              <CardGridCell
                size={size}
                card={fixtureCard({ foil: size === '2x' })}
                qty={size === '1x' ? 1 : 3}
                onActivate={noop}
                caption="$1.25"
                setLabel="MKM · R"
              />
            </div>
          ))}
        </div>
        <SwipeRow className="catalog-swipe" columns={3} tile="card">
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              className="catalog-swipe-tile"
              style={{ backgroundImage: `url("${art(n * 60)}")` }}
            />
          ))}
        </SwipeRow>
      </>
    </Specimen>
  );
}

export function CatalogSections() {
  return (
    <>
      <ButtonSpecimen />
      <ChipSpecimen />
      <SurfaceSpecimen />
      <MeterSpecimen />
      <SymbolSpecimen />
      <FormSpecimen />
      <NavSpecimen />
      <StateSpecimen />
      <CardSpecimen />
    </>
  );
}

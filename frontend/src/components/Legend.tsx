export function Legend() {
  return (
    <div className="legend">
      <span
        style={{
          fontSize: '0.75rem',
          color: 'var(--text3)',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Rarity:
      </span>
      <Item label="Mythic" cls="mythic" />
      <Item label="Rare" cls="rare" />
      <Item label="Uncommon" cls="uncommon" />
      <Item label="Common" cls="common" />
      <Item label="Land" cls="land" />
      <Item label="Empty slot" cls="empty" />
    </div>
  );
}

function Item({ label, cls }: { label: string; cls: string }) {
  return (
    <div className="legend-item">
      <div className={`legend-swatch slot ${cls}`} />
      {label}
    </div>
  );
}

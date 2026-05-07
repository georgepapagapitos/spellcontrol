import { useEffect, useRef, useState } from 'react';

export function Legend() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="legend-disclosure" ref={ref}>
      <button
        type="button"
        className="legend-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Show rarity color key"
        onClick={() => setOpen((v) => !v)}
      >
        Key
      </button>
      {open && (
        <div className="legend-popover" role="dialog" aria-label="Rarity color key">
          <Item label="Mythic" cls="mythic" />
          <Item label="Rare" cls="rare" />
          <Item label="Uncommon" cls="uncommon" />
          <Item label="Common" cls="common" />
          <Item label="Land" cls="land" />
          <Item label="Empty slot" cls="empty" />
        </div>
      )}
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

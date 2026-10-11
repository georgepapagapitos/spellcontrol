import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { RulesReference, RulesReferenceFoot, useRulesBundle } from './RulesReference';
import { type RulesReferenceTab } from '@/store/rules-reference';
import { useRulesReferenceStore, type RulesReferenceTarget } from '@/store/rules-reference';
import { IconButton } from '@/components/shared/Button';

/**
 * The quick-look overlay of the Comprehensive Rules reference: the same
 * keywords / glossary / rules as the `/rules` page, in a sheet you can open
 * mid-game without leaving the table. Mount gate — keeps all hooks inside the
 * body so the sheet can lazy-mount.
 */
export function RulesReferenceSheet() {
  const isOpen = useRulesReferenceStore((s) => s.isOpen);
  const target = useRulesReferenceStore((s) => s.target);
  const close = useRulesReferenceStore((s) => s.close);
  if (!isOpen) return null;
  return <RulesReferenceBody onClose={close} target={target} />;
}

function RulesReferenceBody({
  onClose,
  target,
}: {
  onClose: () => void;
  target: RulesReferenceTarget | null;
}) {
  const bundle = useRulesBundle();
  const [tab, setTab] = useState<RulesReferenceTab>(target?.tab ?? 'keywords');
  const [query, setQuery] = useState(target?.query ?? '');
  const labelId = useId();

  // Don't autofocus the search on touch — it raises the soft keyboard the
  // instant the sheet opens and squashes the layout. Desktop (fine pointer +
  // hover, per the project's touch gate) still gets focus-on-open for typing.
  const autoFocusSearch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'modal-panel-out');

  return createPortal(
    <div
      // Over-sheet: the sheet opens from inside other overlays (a keyword in
      // the card preview, the playtest table), and at the base modal layer it
      // opened underneath them.
      className={`modal-backdrop modal-backdrop--over-sheet rules-ref-backdrop${
        isClosing ? ' is-closing' : ''
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`modal rules-ref-modal${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="modal-header rules-ref-header">
          <h2 id={labelId}>Rules reference</h2>
          <IconButton
            variant="quiet"
            onClick={() => beginClose()}
            label="Close"
            icon={<X width={20} height={20} strokeWidth={1.8} />}
          />
        </div>

        <RulesReference
          bundle={bundle}
          tab={tab}
          query={query}
          onTabChange={setTab}
          onQueryChange={setQuery}
          autoFocusSearch={autoFocusSearch}
          initialExpanded={target?.expand}
          bodyClassName="modal-body"
          onLeave={() => beginClose()}
        />

        <RulesReferenceFoot bundle={bundle} />
      </div>
    </div>,
    document.body
  );
}

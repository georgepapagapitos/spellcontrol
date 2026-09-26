import { Sparkles, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useAiStatus } from '../lib/use-ai-status';
import {
  RulesReference,
  RulesReferenceFoot,
  useRulesBundle,
  type RulesReferenceTab,
} from './RulesReference';
import { useRulesReferenceStore } from '../store/rules-reference';
import './RulesReferenceSheet.css';
import { IconButton } from '@/components/shared/Button';

/**
 * The quick-look overlay of the Comprehensive Rules reference: the same
 * keywords / glossary / rules as the `/rules` page, in a sheet you can open
 * mid-game without leaving the table. Mount gate — keeps all hooks inside the
 * body so the sheet can lazy-mount.
 */
export function RulesReferenceSheet() {
  const isOpen = useRulesReferenceStore((s) => s.isOpen);
  const close = useRulesReferenceStore((s) => s.close);
  if (!isOpen) return null;
  return <RulesReferenceBody onClose={close} />;
}

function RulesReferenceBody({ onClose }: { onClose: () => void }) {
  const bundle = useRulesBundle();
  const [tab, setTab] = useState<RulesReferenceTab>('keywords');
  const [query, setQuery] = useState('');
  const labelId = useId();
  const navigate = useNavigate();
  // The AI door self-hides like every AI surface (null = unavailable/loading).
  const aiStatus = useAiStatus();

  // Don't autofocus the search on touch — it raises the soft keyboard the
  // instant the sheet opens and squashes the layout. Desktop (fine pointer +
  // hover, per the project's touch gate) still gets focus-on-open for typing.
  const autoFocusSearch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'modal-panel-out');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose]);

  return (
    <div
      className={`modal-backdrop rules-ref-backdrop${isClosing ? ' is-closing' : ''}`}
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
            className="modal-close"
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
          bodyClassName="modal-body"
          onLeave={() => beginClose()}
          onAsk={
            aiStatus
              ? (question) => {
                  beginClose();
                  navigate('/rules?tab=ask', { state: { question } });
                }
              : undefined
          }
        />

        {/* The escalation door (E261): browsing didn't settle it → the Ask tab
            of the /rules page, seeded with the current search. Self-hiding
            when AI is unavailable — the sheet without AI is exactly today's
            sheet. */}
        {aiStatus && (
          <button
            type="button"
            className="rules-ref-ask-ai"
            onClick={() => {
              beginClose();
              navigate(
                '/rules?tab=ask',
                query.trim() ? { state: { question: query.trim() } } : undefined
              );
            }}
          >
            <Sparkles width={14} height={14} aria-hidden />
            <span className="rules-ref-ask-ai-text">Ask a rules question</span>
            <span className="rules-ref-ask-ai-hint">AI · cites the rules</span>
          </button>
        )}

        <RulesReferenceFoot bundle={bundle} />
      </div>
    </div>
  );
}

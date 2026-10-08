import './RulesText.css';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import {
  KEYWORD_KIND_LABEL,
  useRulesText,
  type KeywordGloss,
  type OracleSegment,
} from '@/lib/cards/keyword-glossary';
import { useAnchoredPanel } from '@/lib/overlays/use-anchored-panel';
import { useRulesReferenceStore } from '@/store/rules-reference';
import { Button } from '@/components/shared/Button';
import { MagicText } from '@/components/deck/MagicText';

/** One line of rules text: symbols as glyphs, reminder text dimmed, keywords linked. */
export function RulesTextLine({ segments }: { segments: OracleSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'reminder' ? (
          <em key={i} className="rules-text-reminder">
            {s.text}
          </em>
        ) : s.kind === 'keyword' ? (
          <KeywordTerm key={i} entry={s.entry}>
            {s.text}
          </KeywordTerm>
        ) : (
          <MagicText key={i} text={s.text} />
        )
      )}
    </>
  );
}

/** Rules text as one `<p>` per line, for a container that styles its own lines. */
export function RulesTextParagraphs({ text, names }: { text: string; names?: readonly string[] }) {
  const lines = useRulesText(text, names);
  return (
    <>
      {lines.map((segments, i) => (
        <p key={i}>
          <RulesTextLine segments={segments} />
        </p>
      ))}
    </>
  );
}

/**
 * A keyword in rules text. It reads as the word it is, marked only by a
 * dotted underline; a tap or click opens what the rule says it does, with
 * the way into the full rule in the reference. Click, not hover: the text is
 * read with the pointer resting on it, and a bubble that opened under it
 * would cover the next line.
 */
function KeywordTerm({ entry, children }: { entry: KeywordGloss; children: string }) {
  const { open, toggle, close, triggerRef, panelRef, panelStyle } = useAnchoredPanel({
    align: 'left',
  });
  const openRules = useRulesReferenceStore((s) => s.openAt);
  const id = useId();

  const readRule = () => {
    // Focus goes back to the keyword first, so the sheet hands it back there on close.
    close();
    openRules({ tab: 'keywords', query: entry.name, expand: entry.name });
  };

  // The popover portals to <body>, but React still bubbles its events up the
  // component tree: into the card preview's swipe-to-dismiss and its
  // close-on-empty-space click. Nothing that starts in the popover is theirs.
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="keyword-term"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        {children}
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            role="presentation"
            onClick={stop}
            onPointerDown={stop}
            onTouchStart={stop}
            onTouchMove={stop}
            onTouchEnd={stop}
          >
            <div
              ref={panelRef}
              id={id}
              className="keyword-pop"
              role="dialog"
              aria-labelledby={`${id}-name`}
              style={panelStyle}
            >
              <div className="keyword-pop-head">
                <span className="keyword-pop-name" id={`${id}-name`}>
                  {entry.name}
                </span>
                <span className="keyword-pop-meta">
                  {KEYWORD_KIND_LABEL[entry.kind]} · {entry.rule}
                </span>
              </div>
              <p className="keyword-pop-text">
                <MagicText text={entry.text} />
              </p>
              <Button variant="link" className="keyword-pop-read" onClick={readRule}>
                Read the full rule
              </Button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

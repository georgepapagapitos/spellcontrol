import { Copy, ExternalLink, Link2, Search, Share2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import { toast } from '../store/toasts';
import { copyToClipboard } from '@/lib/clipboard';

/** One rule, keyword or glossary term, as the things you can do with it. */
export interface RulesEntry {
  /** Short name for toasts and the share sheet: "Rule 702.2b", "Deathtouch". */
  label: string;
  /** What Copy puts on the clipboard: the number and the official text. */
  text: string;
  /** The entry's own address on /rules (`?tab=…&q=…`), origin-relative. */
  href: string;
  /** Keyword abilities only: the term a `keyword:` card search takes. */
  keyword?: string;
  /** The question Ask opens with. */
  question: string;
}

interface Props {
  entry: RulesEntry;
  /** Present while AI is available: opens the Ask tab seeded with the question. */
  onAsk?: (question: string) => void;
  /** Called before the menu navigates away (the sheet closes itself). */
  onLeave?: () => void;
  /** The row this menu belongs to. A right-click, the Context Menu key or
   *  Shift+F10 on it opens this menu (OverflowMenu `contextHost`); a subrule
   *  inside an open keyword card answers first, so the card's own menu stays
   *  shut. The ⋮ is the visible affordance on every pointer. */
  contextHost: string;
}

/** This menu closes on click, so a copy here confirms with a toast (STYLE
 *  GUIDE § Verbs — Copy) — `what` names the thing copied for both the
 *  success and failure wording. */
async function copyText(text: string, what: string) {
  const ok = await copyToClipboard(text);
  toast.show(
    ok
      ? { message: `Copied ${what}`, tone: 'success' }
      : { message: `Couldn't copy ${what}.`, tone: 'error' }
  );
}

/**
 * The ⋮ menu on every rule, keyword and glossary row: copy the official text
 * for the group chat, share the row's own address, see the cards that carry
 * a keyword (yours, then Scryfall's), and hand the row to Ask. Keyword
 * actions ("Destroy", "Exile") get no card searches: `keyword:` matches
 * abilities, and an empty Scryfall page answers nothing.
 */
export function RulesEntryMenu({ entry, onAsk, onLeave, contextHost }: Props) {
  const navigate = useNavigate();
  const canShare = typeof navigator.share === 'function';
  const url = `${window.location.origin}${entry.href}`;

  const share = async () => {
    try {
      await navigator.share({ title: entry.label, url });
    } catch (err) {
      // A dismissed share sheet rejects; that's a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copyText(url, `link to ${entry.label}`);
    }
  };

  const keywordQuery = entry.keyword
    ? `keyword:${/\s/.test(entry.keyword) ? `"${entry.keyword}"` : entry.keyword}`
    : null;

  const items: OverflowMenuItem[] = [
    {
      label: 'Copy text',
      icon: Copy,
      onClick: () => void copyText(entry.text, entry.label),
    },
    canShare
      ? { label: 'Share link', icon: Share2, onClick: () => void share() }
      : {
          label: 'Copy link',
          icon: Link2,
          onClick: () => void copyText(url, `link to ${entry.label}`),
        },
    ...(keywordQuery
      ? [
          {
            label: 'Cards with this keyword',
            icon: Search,
            onClick: () => {
              onLeave?.();
              navigate(`/search?q=${encodeURIComponent(keywordQuery)}`);
            },
          },
          {
            label: 'Search Scryfall',
            icon: ExternalLink,
            onClick: () => {
              window.open(
                `https://scryfall.com/search?q=${encodeURIComponent(keywordQuery)}`,
                '_blank',
                'noopener'
              );
            },
          },
        ]
      : []),
    ...(onAsk
      ? [{ label: 'Ask AI about this', icon: Sparkles, onClick: () => onAsk(entry.question) }]
      : []),
  ];

  return (
    <OverflowMenu
      className="rules-ref-entry-menu"
      items={items}
      ariaLabel={`Actions for ${entry.label}`}
      contextHost={contextHost}
    />
  );
}

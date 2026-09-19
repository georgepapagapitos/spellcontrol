import { Copy, ExternalLink, Link2, Search, Share2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import { toast } from '../store/toasts';

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
}

/**
 * Opens the entry's menu from a right-click, the Context Menu key or
 * Shift+F10 on the row. The ⋮ kebab is the visible affordance on every
 * pointer; this is the accelerator. Stops at the row so a subrule inside an
 * open keyword card doesn't also open the card's own menu.
 */
export function openEntryMenu(e: React.MouseEvent<HTMLElement>) {
  const trigger = e.currentTarget.querySelector<HTMLButtonElement>('.overflow-menu-trigger');
  if (!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  trigger.click();
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.show({ message: done });
  } catch {
    toast.show({ message: "Couldn't copy that.", tone: 'error' });
  }
}

/**
 * The ⋮ menu on every rule, keyword and glossary row: copy the official text
 * for the group chat, share the row's own address, see the cards that carry
 * a keyword (yours, then Scryfall's), and hand the row to Ask. Keyword
 * actions ("Destroy", "Exile") get no card searches: `keyword:` matches
 * abilities, and an empty Scryfall page answers nothing.
 */
export function RulesEntryMenu({ entry, onAsk, onLeave }: Props) {
  const navigate = useNavigate();
  const canShare = typeof navigator.share === 'function';
  const url = `${window.location.origin}${entry.href}`;

  const share = async () => {
    try {
      await navigator.share({ title: entry.label, url });
    } catch (err) {
      // A dismissed share sheet rejects; that's a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copyText(url, `Link to ${entry.label} copied.`);
    }
  };

  const keywordQuery = entry.keyword
    ? `keyword:${/\s/.test(entry.keyword) ? `"${entry.keyword}"` : entry.keyword}`
    : null;

  const items: OverflowMenuItem[] = [
    {
      label: 'Copy text',
      icon: Copy,
      onClick: () => void copyText(entry.text, `${entry.label} copied.`),
    },
    canShare
      ? { label: 'Share link', icon: Share2, onClick: () => void share() }
      : {
          label: 'Copy link',
          icon: Link2,
          onClick: () => void copyText(url, `Link to ${entry.label} copied.`),
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
    />
  );
}

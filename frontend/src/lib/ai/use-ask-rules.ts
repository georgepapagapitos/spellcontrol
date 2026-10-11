import { useNavigate } from 'react-router-dom';
import { useAiStatus } from './use-ai-status';

/** Cards one question can name before it stops reading as one interaction. */
export const MAX_ASK_CARDS = 4;

/**
 * The question a card door seeds the rules Q&A with. One card asks how it
 * works; several ask how they interact. A seed, never sent: the player edits
 * it into the question they mean and taps Ask.
 */
export function rulesQuestionAbout(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length === 1) return `How does ${unique[0]} work?`;
  const list = `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  return `How do ${list} interact?`;
}

/**
 * Opens the rules Q&A with a question about these cards, or null while AI is
 * unavailable or still loading, so a door renders nothing rather than leading
 * to a page whose Ask tab is hidden. Each card is looked up by its oracle text
 * and official rulings when the question is sent (backend `lookup_card`).
 */
export function useAskRules(): ((names: string[]) => void) | null {
  const status = useAiStatus();
  const navigate = useNavigate();
  if (!status) return null;
  return (names) => navigate('/rules?tab=ask', { state: { question: rulesQuestionAbout(names) } });
}

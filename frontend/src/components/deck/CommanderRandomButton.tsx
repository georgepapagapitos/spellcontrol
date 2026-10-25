import { Shuffle } from 'lucide-react';
import { Button, IconButton } from '@/components/shared/Button';

/**
 * The finder's Random button. On a phone it is an icon with an accessible name,
 * so Bracket, Sort and Random share one toolbar row at 390 wide.
 */
export function CommanderRandomButton({
  compact,
  busy,
  disabled,
  onClick,
}: {
  compact: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const icon = <Shuffle width={14} height={14} strokeWidth={1.8} />;
  return compact ? (
    <IconButton
      variant="secondary"
      label={busy ? 'Picking a commander' : 'Random commander'}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
    />
  ) : (
    <Button icon={icon} onClick={onClick} disabled={disabled}>
      {busy ? 'Picking…' : 'Random'}
    </Button>
  );
}

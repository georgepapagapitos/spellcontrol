import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { OverflowMenu } from '@/components/overlays/OverflowMenu';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { Button, IconButton, buttonClass } from '@/components/shared/Button';

export interface PageHeaderAction {
  label: string;
  icon: LucideIcon;
  /** Exactly one of `onClick` / `to`. */
  onClick?: () => void;
  to?: string;
  /** The page's one filled action. Always visible, at every width. */
  primary?: boolean;
  /** Only ever offered from the ⋮ menu (a destructive action, say). */
  menuOnly?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** Set when the action opens a dialog, so the inline button announces it. */
  opensDialog?: boolean;
}

interface Props {
  title: ReactNode;
  titleId?: string;
  /** One line under the title. */
  meta?: ReactNode;
  metaClassName?: string;
  actions?: PageHeaderAction[];
  /** aria-label for the ⋮ trigger. */
  menuLabel?: string;
  className?: string;
  style?: CSSProperties;
  /** Keep the header one row on a phone: the primary shows as its icon (the
   *  label stays its accessible name and tooltip) instead of stacking under
   *  the title at full width. Hub pages set it so every tab's header is the
   *  same height (STYLE_GUIDE § Layout system → Hub pages). */
  compactPrimary?: boolean;
}

/** Same boundary as the CSS phone tier (binder-hero.css). */
const PHONE = '(max-width: 599px)';

/**
 * The page header every hub and detail page shares (STYLE_GUIDE § Layout
 * system): title, one meta line, then the actions. It owns the action rule
 * so no page re-decides it: the primary is always visible; wider than a phone
 * the first secondary sits beside it; every other action is in the ⋮ menu.
 * The menu holds exactly what isn't on screen, so it never repeats a button.
 */
export function PageHeader({
  title,
  titleId,
  meta,
  metaClassName,
  actions = [],
  menuLabel = 'More actions',
  className,
  style,
  compactPrimary = false,
}: Props) {
  const isPhone = useMediaQuery(PHONE);
  const navigate = useNavigate();

  const primary = actions.find((a) => a.primary);
  const secondary = actions.filter((a) => !a.primary && !a.menuOnly);
  const inline = isPhone ? [] : secondary.slice(0, 1);
  const menu = [
    ...secondary.filter((a) => !inline.includes(a)),
    ...actions.filter((a) => a.menuOnly),
  ];

  return (
    <header className={`binder-hero page-header${className ? ` ${className}` : ''}`} style={style}>
      <div className="page-header-text">
        <h1 className="binder-hero-name" id={titleId}>
          {title}
        </h1>
        {meta && (
          <p className={`binder-hero-meta${metaClassName ? ` ${metaClassName}` : ''}`}>{meta}</p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="page-header-actions">
          {inline.map((a) => (
            <ActionButton key={a.label} action={a} />
          ))}
          {primary && <ActionButton action={primary} iconOnly={compactPrimary && isPhone} />}
          {menu.length > 0 && (
            <OverflowMenu
              triggerClassName={`${buttonClass({ placement: 'row' })} page-header-kebab`}
              ariaLabel={menuLabel}
              items={menu.map((a) => ({
                label: a.label,
                icon: a.icon,
                danger: a.danger,
                disabled: a.disabled,
                onClick: a.to ? () => navigate(a.to as string) : (a.onClick ?? (() => {})),
              }))}
            />
          )}
        </div>
      )}
    </header>
  );
}

function ActionButton({ action: a, iconOnly }: { action: PageHeaderAction; iconOnly?: boolean }) {
  const Icon = a.icon;
  const variant: 'primary' | 'secondary' = a.primary ? 'primary' : 'secondary';
  const className = a.primary ? 'page-header-primary' : undefined;
  if (iconOnly) {
    const glyph = <Icon width={18} height={18} strokeWidth={1.8} />;
    const shared = {
      placement: 'row' as const,
      variant,
      className: 'page-header-primary page-header-primary--icon',
      label: a.label,
      icon: glyph,
      title: a.title,
    };
    return a.to ? (
      <IconButton {...shared} to={a.to} />
    ) : (
      <IconButton
        {...shared}
        onClick={a.onClick}
        disabled={a.disabled}
        aria-haspopup={a.opensDialog ? 'dialog' : undefined}
      />
    );
  }
  const icon = <Icon width={14} height={14} strokeWidth={1.8} />;
  if (a.to) {
    return (
      <Button
        placement="row"
        variant={variant}
        className={className}
        icon={icon}
        to={a.to}
        title={a.title}
      >
        {a.label}
      </Button>
    );
  }
  return (
    <Button
      placement="row"
      variant={variant}
      className={className}
      icon={icon}
      onClick={a.onClick}
      disabled={a.disabled}
      title={a.title}
      aria-haspopup={a.opensDialog ? 'dialog' : undefined}
    >
      {a.label}
    </Button>
  );
}

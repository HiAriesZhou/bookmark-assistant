import { createTranslator } from '../../utils/i18n';
import type { ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function Workspace({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={classNames(
        'scroll-mt-24 overflow-hidden rounded-2xl border border-ui-line bg-ui-surface shadow-ui-sm',
        className
      )}
    >
      {children}
    </section>
  );
}

export function WorkspaceSection({
  id,
  title,
  titleAccessory,
  titleAction,
  children,
  divided = true,
  className,
}: {
  id?: string;
  title?: string;
  titleAccessory?: ReactNode;
  titleAction?: ReactNode;
  children: ReactNode;
  divided?: boolean;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={classNames(
        'px-5 py-5 sm:px-6 sm:py-6',
        divided && 'border-t border-ui-line first:border-t-0',
        className
      )}
    >
      {title ? (
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ui-ink">{title}</h2>
            {titleAccessory}
          </div>
          {titleAction}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// Settings use one level of grouping: a plain heading above a single bordered list.
export function SettingsGroup({
  id,
  title,
  action,
  plain = false,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  /** Render children straight on the page background instead of inside the bordered list. */
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-2 flex h-7 items-center gap-1 px-1">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-ui-ink">
          {title}
        </h2>
        {action}
      </div>
      {plain ? (
        children
      ) : (
        <div className="divide-y divide-ui-line rounded-xl border border-ui-line bg-ui-surface">
          {children}
        </div>
      )}
    </section>
  );
}

// Every row shares the same fixed control column so selects, values and inputs line up.
export function SettingsRow({
  label,
  badge,
  description,
  htmlFor,
  control,
  controlAlign = 'stretch',
}: {
  label: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  control?: ReactNode;
  controlAlign?: 'stretch' | 'end';
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Label {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium text-ui-ink">
            {label}
          </Label>
          {badge}
        </div>
        {description ? (
          <div className="mt-0.5 text-xs leading-5 text-ui-subtle">{description}</div>
        ) : null}
      </div>
      {control ? (
        <div className={classNames('min-w-0', controlAlign === 'end' && 'flex sm:justify-end')}>
          {control}
        </div>
      ) : null}
    </div>
  );
}

export function ProBadge({ onClick }: { onClick?: () => void }) {
  const { t } = createTranslator();
  const className =
    'inline-flex h-5 items-center rounded-full border border-ui-line px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ui-subtle';
  if (!onClick) return <span className={className}>{t('pro')}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('view_plans')}
      className={`${className} hover:border-ui-line-strong hover:text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus`}
    >
      {t('pro')}
    </button>
  );
}

import { CircleAlert, CircleCheck, CircleX, Info, X } from 'lucide-react';
import type { ToastItem } from '../hook/useToast';

export type ToastDensity = 'default' | 'compact';

export function ToastView({
  item,
  onClose,
  density = 'default',
}: {
  item: ToastItem;
  onClose: () => void;
  density?: ToastDensity;
}) {
  const { variant, title, description } = item;

  const styles = {
    success: {
      container: 'bg-green-50 border-green-200 text-green-800',
      icon: CircleCheck,
    },
    info: {
      container: 'bg-blue-50 border-blue-200 text-blue-800',
      icon: Info,
    },
    warning: {
      container: 'bg-amber-50 border-amber-200 text-amber-800',
      icon: CircleAlert,
    },
    error: {
      container: 'bg-red-50 border-red-200 text-red-800',
      icon: CircleX,
    },
  } as const;

  const s = styles[variant];
  const Icon = s.icon;
  const compact = density === 'compact';
  return (
    <div
      className={`flex w-full border shadow-sm ${
        compact
          ? 'items-center gap-2 rounded-lg px-3 py-2'
          : 'max-w-md items-start gap-3 rounded-xl px-4 py-3'
      } ${s.container}`}
      role={variant === 'error' ? 'alert' : 'status'}
      data-toast-size={density}
    >
      <Icon className={`shrink-0 ${compact ? 'h-4 w-4' : 'mt-0.5 h-5 w-5'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>{title}</div>
        {description ? (
          <div className={`${compact ? 'mt-0.5 text-[11px] leading-4' : 'text-sm'} opacity-90`}>
            {description}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className={`shrink-0 rounded hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current focus:ring-offset-1 ${
          compact ? 'p-0.5' : 'p-1'
        }`}
        aria-label="Close notification"
      >
        <X className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
      </button>
    </div>
  );
}

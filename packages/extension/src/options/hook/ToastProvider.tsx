import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext, ToastItem, ToastOptions } from './useToast';
import { ToastView, type ToastDensity } from '../components/Toast';

export function ToastProvider({
  children,
  density = 'default',
}: {
  children: React.ReactNode;
  density?: ToastDensity;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (opts: ToastOptions) => {
      const id = opts.id || Math.random().toString(36).slice(2);
      const item: ToastItem = {
        id,
        title: opts.title,
        description: opts.description ?? '',
        variant: opts.variant ?? 'info',
        duration: opts.duration ?? 4000,
      };
      const existingTimer = timers.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      setToasts((prev) => [...prev.filter((toast) => toast.id !== id), item]);
      const timer = setTimeout(() => dismiss(id), item.duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Top-center toast container */}
      <div
        className={`fixed left-1/2 z-50 flex -translate-x-1/2 flex-col items-center ${
          density === 'compact'
            ? 'top-2 w-[calc(100%-1rem)] max-w-[22rem] gap-1.5'
            : 'top-4 w-[calc(100%-2rem)] max-w-sm gap-2'
        }`}
        aria-live="polite"
        aria-atomic="false"
        data-toast-density={density}
      >
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} density={density} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

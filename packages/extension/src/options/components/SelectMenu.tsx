import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type SelectMenuOption = {
  value: string;
  label: string;
  group?: string;
  icon?: ReactNode;
};

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  prefix,
  triggerIcon,
  disabled = false,
  compactLabel,
  className = '',
}: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  prefix?: string;
  triggerIcon?: ReactNode;
  disabled?: boolean;
  /** Shows a small text trigger with this label instead of the selected option. */
  compactLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const [position, setPosition] = useState<{
    right: number;
    top?: number;
    bottom?: number;
    minWidth: number;
    maxHeight: number;
  }>();

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const viewportPadding = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const openUp = spaceBelow < 288 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(80, openUp ? spaceAbove : spaceBelow);
      setPosition({
        right: Math.max(viewportPadding, window.innerWidth - rect.right),
        ...(openUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
        minWidth: rect.width,
        maxHeight: Math.min(288, availableHeight),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  let previousGroup: string | undefined;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            window.requestAnimationFrame(() => {
              menuRef.current
                ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
                ?.focus();
            });
          }
        }}
        className={
          compactLabel
            ? 'inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-library-muted hover:bg-library-canvas hover:text-library-ink'
            : 'library-select-button !h-auto min-h-9 py-2 disabled:cursor-not-allowed disabled:bg-ui-control-disabled disabled:text-ui-disabled'
        }
      >
        <span className={compactLabel ? 'hidden' : 'flex min-w-0 items-center gap-1.5'}>
          {triggerIcon || selected?.icon ? (
            <span aria-hidden="true" className="shrink-0">
              {triggerIcon ?? selected?.icon}
            </span>
          ) : null}
          <span className="whitespace-normal break-words">
            {prefix ? `${prefix}: ` : ''}
            {selected?.label ?? ''}
          </span>
        </span>
        {compactLabel ? <span className="whitespace-nowrap">{compactLabel}</span> : null}
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-library-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label={ariaLabel}
              onKeyDown={moveFocus}
              style={position}
              className="fixed z-50 w-max max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[10px] border border-library-line bg-white p-1 shadow-library-popover"
            >
              {options.map((option) => {
                const showGroup = Boolean(option.group && option.group !== previousGroup);
                previousGroup = option.group;
                return (
                  <div key={option.value}>
                    {showGroup ? (
                      <p className="mx-2 mb-1 mt-1.5 border-t border-library-line pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-library-faint first:border-0">
                        {option.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      onClick={() => {
                        onChange(option.value);
                        closeAndRestoreFocus();
                      }}
                      className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-library-ink outline-none hover:bg-library-canvas focus:bg-library-canvas ${option.value === value ? 'bg-library-forest-soft font-semibold' : ''}`}
                    >
                      <span className="grid h-4 w-4 shrink-0 place-items-center">
                        {option.value === value ? (
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        ) : null}
                      </span>
                      {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                      <span className="whitespace-nowrap">{option.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

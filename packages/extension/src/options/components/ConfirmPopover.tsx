import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_PADDING = 8;
const POPOVER_GAP = 6;
const POPOVER_WIDTH = 236;

export function ConfirmPopover({
  open,
  anchor,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  anchor?: HTMLElement;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>();

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, rect.right - POPOVER_WIDTH)
      );
      const openAbove = rect.top >= 96;
      setPosition({
        left,
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + POPOVER_GAP }
          : { top: rect.bottom + POPOVER_GAP }),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !anchor?.contains(target) && !busy) onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, busy, onCancel, open]);

  useEffect(() => {
    if (open && position) cancelRef.current?.focus();
  }, [open, position]);

  if (!open || !anchor || !position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      style={{ ...position, width: POPOVER_WIDTH }}
      className="fixed z-50 rounded-[10px] border border-library-line bg-white p-3 shadow-library-popover"
    >
      <p id={titleId} className="text-xs font-semibold text-library-ink">
        {title}
      </p>
      <p id={descriptionId} className="mt-1 text-[11px] leading-4 text-library-muted">
        {description}
      </p>
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          ref={cancelRef}
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex h-7 items-center justify-center rounded-md border border-library-line bg-white px-2.5 text-[11px] font-semibold text-library-ink transition hover:bg-library-canvas disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex h-7 items-center justify-center rounded-md bg-ui-danger px-2.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}

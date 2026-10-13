'use client';
import * as React from 'react';
import { cn } from '@/components/lib/cn';

const ItemContext = React.createContext<{ open: boolean; toggle: () => void } | null>(null);

export function Accordion({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

export function AccordionItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ctx = React.useMemo(() => ({ open, toggle: () => setOpen((o) => !o) }), [open]);
  return (
    <ItemContext.Provider value={ctx}>
      <div className={cn('rounded-lg border border-[#e8eaed] bg-white px-6', className)}>
        {children}
      </div>
    </ItemContext.Provider>
  );
}

export function AccordionTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(ItemContext);
  if (!ctx) throw new Error('AccordionTrigger must be used within AccordionItem');
  const { open, toggle } = ctx;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={toggle}
      className={cn(
        'flex w-full items-center justify-between rounded-md py-4 text-left text-base font-medium text-[#16181d] hover:text-[#4d684d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00] focus-visible:ring-offset-2',
        className
      )}
    >
      <span>{children}</span>
      <span className={cn('ml-2 transition-transform', open ? 'rotate-180' : 'rotate-0')}>▾</span>
    </button>
  );
}

export function AccordionContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(ItemContext);
  if (!ctx) throw new Error('AccordionContent must be used within AccordionItem');
  return (
    <div className={cn('pb-4 text-base text-[#667085]', ctx.open ? 'block' : 'hidden', className)}>
      {children}
    </div>
  );
}

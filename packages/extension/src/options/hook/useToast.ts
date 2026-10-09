import { createContext, useContext } from 'react';

export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  id?: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms
}

export interface ToastItem extends Required<Omit<ToastOptions, 'duration' | 'variant'>> {
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  show: (opts: ToastOptions) => string; // returns id
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

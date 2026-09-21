'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---------------- Button ---------------- */

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/30',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-ink)] text-white hover:bg-[#2a2a31]',
        accent: 'bg-[var(--color-accent)] text-white hover:bg-[#2950d4]',
        secondary:
          'bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]',
        ghost: 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
        danger: 'text-[#b42318] hover:bg-[#fef3f2] border border-transparent hover:border-[#fecdca]',
      },
      size: {
        xs: 'h-6 px-2 text-[11px]',
        sm: 'h-7 px-2.5 text-[12px]',
        md: 'h-8 px-3 text-[13px]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

/* ---------------- Inputs ---------------- */

const fieldBase =
  'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-line-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/15';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-8', className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'resize-y leading-relaxed', className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-8 cursor-pointer pr-7', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-3)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------- Chips & badges ---------------- */

export function Chip({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-[1px] text-[10px] font-medium text-[var(--color-ink-2)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)} />;
}

/* ---------------- Layout helpers ---------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
      {children}
    </h3>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-[var(--color-ink-2)]">{title}</p>
      {hint ? <p className="max-w-sm text-[12px] text-[var(--color-ink-3)]">{hint}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent',
        className,
      )}
    />
  );
}

/* ---------------- Drawer ---------------- */

export function Drawer({
  open,
  onClose,
  width = 'w-[560px]',
  children,
}: {
  open: boolean;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fade-in absolute inset-0 bg-[#17171b]/12"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'drawer-in relative flex h-full max-w-[92vw] flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-[-8px_0_28px_-18px_rgba(0,0,0,0.3)]',
          width,
        )}
      >
        {children}
      </aside>
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; badge?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-[var(--color-line)] px-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative -mb-px flex items-center gap-1.5 border-b-[1.5px] px-2.5 py-2 text-[12px] font-medium transition-colors',
            active === t.id
              ? 'border-[var(--color-ink)] text-[var(--color-ink)]'
              : 'border-transparent text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]',
          )}
        >
          {t.label}
          {t.badge ? (
            <span className="rounded bg-[var(--color-surface-2)] px-1 text-[10px] text-[var(--color-ink-3)] numeric">
              {t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

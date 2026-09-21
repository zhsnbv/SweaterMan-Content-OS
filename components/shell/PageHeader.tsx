export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[13px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <span className="truncate text-[11.5px] text-[var(--color-ink-3)]">{subtitle}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}

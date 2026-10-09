import type { ReactNode } from "react";
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-5 lg:px-8 pt-6 lg:pt-9 pb-5">
      <div>
        <h1 className="font-serif text-[32px] lg:text-[38px] leading-none font-light tracking-[-0.01em]">{title}</h1>
        {subtitle && <div className="text-graphite mt-2 text-[14px]">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

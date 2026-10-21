import type { ReactNode } from "react";

/** Um número grande com rótulo (Salão e Financeiro). Vai dentro de um <dl>. */
export function Fig({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="@container min-w-0">
      <dt className="text-sm text-graphite">{label}</dt>
      <dd>
        <p className="font-display font-medium leading-none tabular mt-1 whitespace-nowrap text-[clamp(22px,14cqw,34px)]">{value}</p>
        {sub && <div className="mt-1.5">{sub}</div>}
      </dd>
    </div>
  );
}

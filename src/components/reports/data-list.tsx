import type { ReactNode } from "react";

export type Col<T> = { key: string; label: string; align?: "right"; render: (row: T) => ReactNode };

/**
 * Tabela que vira lista em telas estreitas (390 px sem rolagem lateral): a primeira coluna vira o título e as outras, pares rótulo/valor.
 */
export function DataList<T>({ rows, cols, rowKey, caption }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; caption: string }) {
  const [first, ...rest] = cols;
  return (
    <>
      <table className="hidden sm:table w-full text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-[13px] text-muted">
            {cols.map((c) => <th key={c.key} scope="col" className={`py-2 pr-3 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-line">
              {cols.map((c, i) => <td key={c.key} className={`py-2.5 pr-3 tabular ${c.align === "right" ? "text-right" : ""} ${i === 0 ? "font-medium" : ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="sm:hidden flex flex-col" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="border-t border-line py-3">
            <p className="font-medium text-[16px]">{first.render(r)}</p>
            <dl className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-x-4 gap-y-1.5 text-[14px]">
              {rest.map((c) => (
                <div key={c.key} className="min-w-0"><dt className="text-[13px] text-muted">{c.label}</dt><dd className="tabular">{c.render(r)}</dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

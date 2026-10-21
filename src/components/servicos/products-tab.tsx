"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconSearch } from "@/components/icons";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";
import { qtyText } from "@/lib/estoque-view";
import type { ProductRow } from "@/server/domain/estoque/produtos";
import { ProductSheet } from "./product-sheet";

type Filter = "todos" | "abaixo" | "desativados";
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const situacao = (r: ProductRow) => (!r.active ? "Desativado" : r.negative ? "Estoque negativo" : r.below ? "Abaixo do mínimo" : "Ok");

/**
 * Serviços e pacotes › Produtos ("o que a Casa vende e quanto tem?"): o catálogo com o estoque de cada produto. `can.produtos` cria e muda o
 * produto; `can.movimentar` dá entrada, saída e ajusta o estoque. Sem nenhuma das duas, só consulta.
 */
/** `padrao`: o CFOP e o CSOSN de Configurações › Estoque, que o produto novo traz preenchidos (M-3). */
export function ProductsTab({ rows, can, padrao }: { rows: ProductRow[]; can: { produtos: boolean; movimentar: boolean }; padrao?: { cfop: string; csosn: string } }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [open, setOpen] = useState<string | "novo" | null>(null);
  const active = rows.filter((r) => r.active);
  const counts = { abaixo: active.filter((r) => r.below || r.negative).length, desativados: rows.length - active.length };
  const shown = useMemo(() => {
    const base = filter === "desativados" ? rows.filter((r) => !r.active) : filter === "abaixo" ? active.filter((r) => r.below || r.negative) : active;
    const t = fold(q.trim());
    return t ? base.filter((r) => fold(r.name).includes(t) || fold(r.brand ?? "").includes(t) || (r.barcode ?? "").includes(q.trim())) : base;
  }, [rows, active, filter, q]);
  const current = open && open !== "novo" ? rows.find((r) => r.id === open) ?? null : null;
  const chips: [Filter, string, number | null][] = [["todos", "Todos", active.length], ["abaixo", "Abaixo do mínimo", counts.abaixo], ["desativados", "Desativados", counts.desativados]];
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c?.trim()))], [rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="search" className="relative w-full lg:max-w-md">
          <label htmlFor="produtos-q" className="sr-only">Buscar produto</label>
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input id="produtos-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, marca ou código de barras" autoComplete="off" enterKeyHint="search"
            className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-md text-ink outline-none transition-[border-color,box-shadow] focus:border-ink focus:shadow-[0_0_0_3px_rgb(184_134_63/0.22)] lg:h-10 lg:text-base" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Mostrar" className="flex flex-wrap gap-2">
            {chips.filter(([k, , n]) => k === "todos" || n).map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors lg:h-9",
                  filter === k ? "border-ink bg-ink text-paper" : "border-line bg-paper text-graphite hover:border-line-strong hover:text-ink")}>
                {label}<span className={cn("tabular-nums", filter === k ? "text-paper/70" : "text-muted")}>{n}</span>
              </button>
            ))}
          </nav>
          {can.produtos && <Button variant="gold" onClick={() => setOpen("novo")}>Novo produto</Button>}
        </div>
      </div>

      {shown.length ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-base">
            <caption className="sr-only">Produtos e estoque</caption>
            <thead>
              <tr className="border-b border-line text-sm text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Produto</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">Marca</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Preço</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Estoque</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {shown.map((r) => (
                <tr key={r.id} className={cn("hover:bg-paper-2/60", !r.active && "text-muted")}>
                  <td className="px-4 py-1">
                    <button type="button" onClick={() => setOpen(r.id)} className="min-h-11 w-full text-left font-medium text-ink">{r.name}</button>
                  </td>
                  <td className="hidden px-3 sm:table-cell">{r.brand ?? "—"}</td>
                  <td className="px-3 text-right tabular-nums">{r.priceCents == null ? "Sem preço" : formatBRL(r.priceCents)}</td>
                  <td className={cn("px-3 text-right tabular-nums", (r.negative || r.below) && r.active && "font-semibold text-alert")}>{qtyText(r.stockQty)}</td>
                  <td className={cn("hidden px-4 text-sm sm:table-cell", r.active && (r.negative || r.below) ? "text-alert" : "text-graphite")}>{situacao(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-10 text-center">
          <p className="text-base text-ink">{q ? `Nenhum produto com “${q}”.` : rows.length ? "Nada aqui." : "Nenhum produto cadastrado ainda."}</p>
          {q && <button type="button" onClick={() => setQ("")} className="mt-2 text-sm font-medium text-gold-ink underline underline-offset-4">Limpar a busca</button>}
        </div>
      )}
      <ProductSheet key={open ?? "fechado"} open={!!open} product={current} categories={categories} can={can} padrao={padrao} onClose={() => setOpen(null)} />
    </div>
  );
}

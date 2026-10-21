"use client";
import { useRouter, useSearchParams } from "next/navigation";

/** Filtro por etiqueta (Fila e Contatos): troca só o `etiqueta` da URL e mantém os outros filtros. */
export function TagFilter({ tags, value, basePath, className, allLabel = "Todas as etiquetas" }: { tags: { id: string; name: string; uses: number }[]; value: string | null; basePath: "/atendimento" | "/contatos"; className?: string; /** Rótulo do "sem filtro" (a Fila usa "Etiqueta", que cabe na linha). */ allLabel?: string }) {
  const router = useRouter(); const sp = useSearchParams();
  if (!tags.length) return null;
  return (
    <select aria-label="Filtrar por etiqueta" value={value ?? ""} className={className ?? "h-11 lg:h-9 w-full rounded-[var(--radius-control)] border border-control bg-paper px-3 text-md lg:text-sm"}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set("etiqueta", e.target.value); else p.delete("etiqueta");
        p.delete("p"); // Contatos: volta para a 1ª página
        router.replace(p.size ? `${basePath}?${p}` : basePath, { scroll: false });
      }}>
      <option value="">{allLabel}</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.uses})</option>)}
    </select>
  );
}

"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";

/** Filtro por tipo da página de Exceções: troca `tipo` na URL e mantém o período. */
export function ExcecoesTipo({ value, options, extra }: { value: string | null; options: { kind: string; label: string }[]; extra: { kind: string; label: string } | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const list = extra ? [...options, extra] : options;
  return (
    <label className="flex flex-col gap-1 text-sm text-graphite">
      Tipo
      <Select value={value ?? ""} className="min-w-64" onChange={(e) => {
        const q = new URLSearchParams(sp.toString());
        if (e.target.value) q.set("tipo", e.target.value); else q.delete("tipo");
        router.replace(`/relatorios/excecoes?${q}`, { scroll: false });
      }}>
        <option value="">Todos os tipos</option>
        {list.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
      </Select>
    </label>
  );
}

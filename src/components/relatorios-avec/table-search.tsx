"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconSearch } from "@/components/icons";

/** Busca na tabela do relatório: espera 250 ms depois da última tecla e guarda o termo na URL (?q=), voltando para a página 1. */
export function AvecTableSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [sent, setSent] = useState(initial.trim());
  const [seen, setSeen] = useState(initial);
  const router = useRouter();
  const path = usePathname();
  // A URL mudou por fora (voltar/avançar): o campo acompanha.
  if (initial !== seen) {
    setSeen(initial);
    if (initial.trim() !== sent) { setSent(initial.trim()); setQ(initial); }
  }
  useEffect(() => {
    const term = q.trim();
    if (term === sent) return;
    const t = setTimeout(() => { setSent(term); router.replace(term ? `${path}?q=${encodeURIComponent(term)}` : path, { scroll: false }); }, 250);
    return () => clearTimeout(t);
  }, [q, sent, path, router]);
  return (
    <label className="relative block w-full sm:w-80">
      <span className="sr-only">Buscar nesta tabela</span>
      <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, serviço, data…" autoComplete="off" enterKeyHint="search"
        className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-md outline-none focus:border-ink sm:h-10 sm:text-base" />
    </label>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@/components/icons";

/** Campo de busca: espera 250 ms depois da última tecla e guarda o termo na URL (?q=), mantendo os outros filtros. */
export function SearchBox({ initial, keep }: { initial: string; keep: Record<string, string> }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const sent = useRef(initial);
  useEffect(() => {
    const term = q.trim();
    if (term === sent.current.trim()) return;
    const t = setTimeout(() => {
      sent.current = q;
      const sp = new URLSearchParams(keep);
      if (term) sp.set("q", term);
      router.replace(sp.size ? `/contatos?${sp}` : "/contatos");
    }, 250);
    return () => clearTimeout(t);
  }, [q, keep, router]);
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">Buscar por nome, telefone ou trecho de mensagem</span>
      <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input type="search" name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, telefone ou mensagem" autoComplete="off" enterKeyHint="search"
        className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-md outline-none focus:border-ink sm:h-10 sm:text-base" />
    </label>
  );
}

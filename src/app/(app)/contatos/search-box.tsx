"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@/components/icons";

export function SearchBox({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial); const router = useRouter();
  useEffect(() => { if (q === initial) return; const t = setTimeout(() => router.replace(q ? `/contatos?q=${encodeURIComponent(q)}` : "/contatos"), 300); return () => clearTimeout(t); }, [q, initial, router]);
  return (
    <label className="relative"><span className="sr-only">Buscar</span>
      <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, telefone ou e-mail" className="h-9 w-60 pl-9 pr-3 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm outline-none focus:border-ink" />
    </label>
  );
}

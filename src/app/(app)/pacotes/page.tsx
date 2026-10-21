import { redirect } from "next/navigation";
import { requirePerm } from "@/server/auth/session";

/** Pacotes (16/10) virou Clientes › Com pacote (pedido do dono, 18/10). Endereço antigo leva para lá com os filtros. */
export default async function PacotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePerm("atendimento.ver");
  const sp = await searchParams;
  const s = new URLSearchParams({ vista: "pacote" });
  for (const k of ["situacao", "q", "pacote"]) { const v = sp[k]; if (typeof v === "string" && v) s.set(k, v); }
  redirect(`/contatos?${s}`);
}

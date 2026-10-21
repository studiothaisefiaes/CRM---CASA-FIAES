import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { countScheduled, listScheduled, type ScheduledRange } from "@/server/queries/scheduled-list";
import { LiveRefresh } from "@/components/shell/live";
import { WorkspaceBar } from "@/components/queue/workspace-bar";
import { ProgramadasView } from "@/components/queue/programadas-view";

export const metadata = { title: "Mensagens programadas" };

/**
 * Mensagens programadas (pedido do dono 16/10: "cadê um local para eu rever as mensagens agendadas?"): todas as que vão sair sozinhas,
 * por dia, com Abrir conversa, Editar (o mesmo diálogo do Retomar, com "Escrever com IA") e Cancelar (com Desfazer).
 * Embaixo, recolhidas, as que não saíram nas últimas 24 h. Escopo da Fila (atendente sem "Ver conversas de todas": as dela e as sem dono).
 */
export default async function ProgramadasPage({ searchParams }: PageProps<"/atendimento/programadas">) {
  const user = await requirePerm("atendimento.ver");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim().slice(0, 80) : "");
  const quem = one("quem") === "minhas" ? "minhas" : "todas";
  const periodo: ScheduledRange = one("periodo") === "hoje" ? "hoje" : one("periodo") === "7d" ? "7d" : "todas";
  const q = one("q");
  const now = new Date();
  const [data, total] = await Promise.all([listScheduled(user, { mine: quem === "minhas", range: periodo, q, now }), countScheduled(user)]);
  return (
    <main className="min-h-[calc(100dvh-3.5rem-5rem)] lg:min-h-dvh flex flex-col">
      <WorkspaceBar current="programadas" quadro={can(user.perms, "quadro.ver")} programadas={total} />
      <LiveRefresh scopes={["queue"]} />
      <ProgramadasView data={data} params={{ quem, periodo, q }} onlyOwnScope={!can(user.perms, "atendimento.todas")} nowIso={now.toISOString()} />
    </main>
  );
}

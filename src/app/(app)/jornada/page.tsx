import { requirePerm } from "@/server/auth/session";
import { getJourney } from "@/server/queries/journey";
import { Journey } from "@/components/journey/journey";
import { LiveRefresh } from "@/components/shell/live";
import { PageBack, PageHeader } from "@/components/page-header";

export const metadata = { title: "Jornada" };

/**
 * A visão da gestão: as clientes de cada etapa, com a foto e o tempo de espera. Só a gestão entra; a atendente recebe 404 (a tela nem existe para ela).
 * Fica em Relatórios (menu de 17/10): o link antigo continua abrindo aqui, com Relatórios aceso no menu.
 */
export default async function JornadaPage() {
  await requirePerm("jornada.ver");
  const journey = await getJourney();
  const open = journey.stations.filter((s) => s.kind !== "fechado" && s.kind !== "perdido");
  const total = open.reduce((n, s) => n + s.count, 0), late = open.reduce((n, s) => n + s.late, 0);
  return (
    <main>
      <PageHeader title="Jornada"
        subtitle={`${total} ${total === 1 ? "conversa" : "conversas"} em andamento${late ? ` · ${late} atrasado${late === 1 ? "" : "s"}` : ""} · abra uma etapa para ver a Fila`}
        back={<PageBack href="/relatorios">Relatórios</PageBack>} />
      <LiveRefresh scopes={["queue"]} />
      <Journey journey={journey} />
    </main>
  );
}

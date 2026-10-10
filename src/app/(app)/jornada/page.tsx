import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getJourney } from "@/server/queries/journey";
import { PageHeader } from "@/components/page-header";
import { Journey } from "@/components/journey/journey";
import { LiveRefresh } from "@/components/shell/live";
import { ViewSwitch } from "@/components/queue/view-switch";

export const metadata = { title: "Jornada" };

/** A visão da gestão: as clientes de cada etapa, com a foto e o tempo de espera. Só a gestão entra; a atendente recebe 404 (a tela nem existe para ela). */
export default async function JornadaPage() {
  const user = await requireUser();
  if (user.role !== "gestor") notFound();
  const journey = await getJourney();
  const open = journey.stations.filter((s) => s.kind !== "fechado" && s.kind !== "perdido");
  const total = open.reduce((n, s) => n + s.count, 0), late = open.reduce((n, s) => n + s.late, 0);
  return (
    <main>
      <PageHeader title="Jornada" subtitle={`${total} lead${total === 1 ? "" : "s"} em andamento${late ? ` · ${late} atrasado${late === 1 ? "" : "s"}` : ""} · toque numa etapa para ver a Fila`}
        actions={<ViewSwitch current="jornada" journey />} />
      <LiveRefresh scopes={["queue"]} />
      <Journey journey={journey} />
    </main>
  );
}

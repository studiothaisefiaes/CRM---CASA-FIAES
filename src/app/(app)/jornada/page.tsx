import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getJourney } from "@/server/queries/journey";
import { Journey } from "@/components/journey/journey";
import { LiveRefresh } from "@/components/shell/live";
import { WorkspaceBar } from "@/components/queue/workspace-bar";

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
      <WorkspaceBar current="jornada" journey />
      <p className="px-5 lg:px-8 pt-5 pb-4 text-graphite text-base">{`${total} lead${total === 1 ? "" : "s"} em andamento${late ? ` · ${late} atrasado${late === 1 ? "" : "s"}` : ""} · abra uma etapa para ver a Fila`}</p>
      <LiveRefresh scopes={["queue"]} />
      <Journey journey={journey} />
    </main>
  );
}

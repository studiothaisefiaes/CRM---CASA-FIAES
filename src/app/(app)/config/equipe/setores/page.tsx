import { and, asc, eq } from "drizzle-orm";
import { canReceiveConversation } from "@/server/domain/team-scope";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { listTeams } from "@/server/domain/teams";
import { TeamsEditor } from "@/components/config/teams";
import { TeamTabs } from "@/components/config/team-tabs";
export const metadata = { title: "Setores" };
export default async function SetoresPage() {
  const me = await requireAnyPerm("setores.gerir", "equipe.gerir");
  // Só quem atende entra num setor (o setor passa conversas): o Contador e quem só tem o app da profissional ficam de fora.
  const [teams, people] = await Promise.all([listTeams(), db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), canReceiveConversation())).orderBy(asc(users.name))]);
  return (
    <>
      <TeamTabs current="setores" perms={me.perms} />
      <TeamsEditor teams={teams} people={people} canManage={can(me.perms, "setores.gerir")} />
    </>
  );
}

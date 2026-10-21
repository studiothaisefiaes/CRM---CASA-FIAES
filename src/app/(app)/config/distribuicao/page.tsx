import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { distributionTeam, getDistributionSettings } from "@/server/domain/distribution";
import { DistributionEditor } from "@/components/config/distribution";
import { LiveRefresh } from "@/components/shell/live";
import { TeamTabs } from "@/components/config/team-tabs";
export const metadata = { title: "Quem recebe conversa nova" };
export default async function DistribuicaoPage() {
  const user = await requireAnyPerm("config.diaadia", "config.sistema");
  const [cfg, team] = await Promise.all([getDistributionSettings(), distributionTeam()]);
  return (
    <>
      <LiveRefresh scopes={["team", "queue"]} />
      <TeamTabs current="distribuicao" perms={user.perms} />
      <DistributionEditor initial={cfg} canSystem={can(user.perms, "config.sistema")} canLevels={can(user.perms, "config.diaadia")}
        team={team.map((t) => ({ id: t.id, name: t.name, availability: t.availability, online: t.online, priorityLevel: t.priorityLevel, waiting: t.waiting }))} />
    </>
  );
}

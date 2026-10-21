import { requirePerm } from "@/server/auth/session";
import { listProfiles } from "@/server/domain/profiles";
import { ProfilesEditor } from "@/components/config/profiles-editor";
import { TeamTabs } from "@/components/config/team-tabs";
import { StrictScopeSwitch } from "@/components/config/strict-scope-switch";
import { getStrictScope } from "@/server/domain/deal-scope";
export const metadata = { title: "Perfis de acesso" };
export default async function PerfisPage() {
  const me = await requirePerm("equipe.gerir");
  return (
    <>
      <TeamTabs current="perfis" perms={me.perms} />
      <StrictScopeSwitch initial={await getStrictScope()} />
      <ProfilesEditor profiles={await listProfiles()} />
    </>
  );
}

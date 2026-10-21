import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { requirePerm } from "@/server/auth/session";
import { listProfiles } from "@/server/domain/profiles";
import { TeamEditor } from "@/components/config/team";
import { TeamTabs } from "@/components/config/team-tabs";
export const metadata = { title: "Pessoas" };
export default async function EquipePage() {
  const me = await requirePerm("equipe.gerir");
  const [rows, profiles] = await Promise.all([db.select().from(users).orderBy(asc(users.name)), listProfiles()]);
  return (
    <>
      <TeamTabs current="pessoas" perms={me.perms} />
      <TeamEditor me={me.id} profiles={profiles.map((p) => ({ id: p.id, name: p.name, key: p.key }))}
        members={rows.map((u) => ({ id: u.id, name: u.name, email: u.email, profileId: u.profileId, active: u.active, pending: !u.passwordHash, signature: u.signature }))} />
    </>
  );
}

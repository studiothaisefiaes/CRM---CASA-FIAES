import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { requirePerm } from "@/server/auth/session";
import { listProfiles } from "@/server/domain/profiles";
import { TeamEditor } from "@/components/config/team";
import { TeamTabs } from "@/components/config/team-tabs";
import { ContadorLinkPanel } from "@/components/config/contador-link";
import { listContadorLinks } from "@/server/domain/contador-link";
export const metadata = { title: "Pessoas" };
export default async function EquipePage() {
  const me = await requirePerm("equipe.gerir");
  const [rows, profiles, links] = await Promise.all([db.select().from(users).orderBy(asc(users.name)), listProfiles(), listContadorLinks()]);
  // Sem perfil, a pessoa é do tempo do papel antigo (atende); com perfil, atende quem abre as Conversas.
  const atende = new Map(profiles.map((p) => [p.id, p.permissions.includes("atendimento.ver")]));
  return (
    <>
      <TeamTabs current="pessoas" perms={me.perms} />
      {profiles.some((p) => p.key === "contador") && (
        <ContadorLinkPanel pending={links.map((l) => ({ id: l.id, createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt.toISOString(), createdByName: l.createdByName }))} />
      )}
      <TeamEditor me={me.id} profiles={profiles.map((p) => ({ id: p.id, name: p.name, key: p.key }))}
        members={rows.map((u) => ({ id: u.id, name: u.name, email: u.email, profileId: u.profileId, active: u.active, pending: !u.passwordHash, signature: u.signature,
          atende: u.profileId ? atende.get(u.profileId) ?? true : true }))} />
    </>
  );
}

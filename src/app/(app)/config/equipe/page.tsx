import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { requireGestor } from "@/server/auth/session";
import { TeamEditor } from "@/components/config/team";
export const metadata = { title: "Equipe" };
export default async function EquipePage() {
  const me = await requireGestor();
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return <TeamEditor me={me.id} members={rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, pending: !u.passwordHash }))} />;
}

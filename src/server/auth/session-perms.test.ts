import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles, users } from "../db/schema";
import { insertSession, findSessionUser } from "./sessions-store";
import { SYSTEM_PROFILES } from "@/lib/permissions";
import { resetDb } from "../../../test/db";

const profileId = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0].id;

describe("sessão com permissões do perfil", () => {
  beforeEach(resetDb);

  it("carrega o nome e as permissões do perfil da pessoa", async () => {
    const [u] = await db.insert(users).values({ name: "Rita", email: "rita@x.local", profileId: await profileId("recepcao") }).returning();
    const { token } = await insertSession(u.id);
    const s = await findSessionUser(token);
    expect(s?.profileName).toBe("Recepção");
    expect([...s!.perms].sort()).toEqual([...SYSTEM_PROFILES.find((p) => p.key === "recepcao")!.permissions].sort());
  });

  it("trocar o perfil vale na próxima requisição, sem sair da conta", async () => {
    const [u] = await db.insert(users).values({ name: "Rita", email: "rita@x.local", profileId: await profileId("recepcao") }).returning();
    const { token } = await insertSession(u.id);
    expect((await findSessionUser(token))!.perms).not.toContain("relatorios.ver");
    await db.update(users).set({ profileId: await profileId("gestao") }).where(eq(users.id, u.id));
    expect((await findSessionUser(token))!.perms).toContain("relatorios.ver");
  });

  it("descarta permissão desconhecida gravada no perfil", async () => {
    const [p] = await db.insert(profiles).values({ name: "Teste", permissions: ["atendimento.ver", "coisa.velha"] }).returning();
    const [u] = await db.insert(users).values({ name: "T", email: "t@x.local", profileId: p.id }).returning();
    const { token } = await insertSession(u.id);
    expect((await findSessionUser(token))!.perms).toEqual(["atendimento.ver"]);
  });

  it("pessoa desativada não tem sessão", async () => {
    const [u] = await db.insert(users).values({ name: "X", email: "x@x.local", active: false }).returning();
    const { token } = await insertSession(u.id);
    expect(await findSessionUser(token)).toBeNull();
  });
});

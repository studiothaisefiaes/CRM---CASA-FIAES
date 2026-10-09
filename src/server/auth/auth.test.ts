import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, sessions } from "../db/schema";
import { hashPassword, verifyPassword } from "./password";
import { insertSession, findSessionUser } from "./sessions-store";
import { createInvite, acceptInvite, checkCredentials } from "./users";
import { hashToken } from "./tokens";
import { allow } from "./rate-limit";
import { resetDb } from "../../../test/db";

describe("auth", () => {
  beforeEach(resetDb);

  it("hash e verificação de senha", async () => {
    const h = await hashPassword("segredo-forte");
    expect(await verifyPassword(h, "segredo-forte")).toBe(true);
    expect(await verifyPassword(h, "errada")).toBe(false);
    expect(await verifyPassword(null, "x")).toBe(false);
  });

  it("sessão: guarda só o hash, expira e respeita usuário desativado", async () => {
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana@casa.com", role: "atendente" }).returning();
    const { token } = await insertSession(u.id);
    const [row] = await db.select().from(sessions);
    expect(row.idHash).toBe(hashToken(token));
    expect(row.idHash).not.toContain(token);
    expect((await findSessionUser(token))?.name).toBe("Ana");
    expect(await findSessionUser(token, new Date(Date.now() + 31 * 86_400_000))).toBeNull();
    await db.update(users).set({ active: false }).where(eq(users.id, u.id));
    expect(await findSessionUser(token)).toBeNull();
    expect(await findSessionUser(undefined)).toBeNull();
  });

  it("convite: cria, aceita uma vez e permite login", async () => {
    const token = await createInvite({ name: "Bruna", email: "Bruna@Casa.com", role: "atendente" });
    await expect(acceptInvite(token, "curta")).rejects.toThrow(/8 caracteres/);
    await acceptInvite(token, "senha-boa-123");
    await expect(acceptInvite(token, "senha-boa-123")).rejects.toThrow(/expirou/);
    expect((await checkCredentials("bruna@casa.com", "senha-boa-123"))?.name).toBe("Bruna");
    expect(await checkCredentials("bruna@casa.com", "errada")).toBeNull();
    expect(await checkCredentials("ninguem@casa.com", "x")).toBeNull();
  });

  it("limite de tentativas", () => {
    for (let i = 0; i < 5; i++) expect(allow("k", 5, 1000, 0)).toBe(true);
    expect(allow("k", 5, 1000, 10)).toBe(false);
    expect(allow("k", 5, 1000, 2000)).toBe(true);
  });
});

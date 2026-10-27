import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, openInvites, profiles, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { checkCredentials, inviteLanding } from "../auth/users";
import { hashPassword } from "../auth/password";
import { hashToken } from "../auth/tokens";
import { acceptContadorLink, createContadorLink, findContadorLink, listContadorLinks, revokeContadorLink } from "./contador-link";
import { saveProfile } from "./profiles";

let g = "", contador = "";
const form = (over: Partial<{ name: string; email: string; password: string }> = {}) => ({ name: "Carlos Contador", email: "carlos@contabil.com", password: "senha-do-carlos", ...over });
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

beforeEach(async () => {
  await resetDb();
  const gestao = (await db.select().from(profiles).where(eq(profiles.key, "gestao")))[0].id;
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: await hashPassword("senha-da-gestora"), profileId: gestao }).returning())[0].id;
  contador = (await db.select().from(profiles).where(eq(profiles.key, "contador")))[0].id;
});

describe("link do contador: gerar", () => {
  it("o seed cria o perfil de sistema Contador", async () => {
    const [p] = await db.select().from(profiles).where(eq(profiles.key, "contador"));
    expect(p).toMatchObject({ name: "Contador", isSystem: true });
  });

  it("gera um link de 7 dias amarrado ao perfil Contador; no banco fica só o hash; fica na auditoria", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const l = await createContadorLink(g, now);
    expect(l.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const [row] = await db.select().from(openInvites);
    expect(row).toMatchObject({ profileId: contador, tokenHash: hashToken(l.token), createdBy: g, usedAt: null, revokedAt: null });
    expect(row.expiresAt.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(JSON.stringify(row)).not.toContain(l.token);
    const [a] = await audits("gerou_link_contador");
    expect(a).toMatchObject({ userId: g, entity: "open_invite", entityId: row.id });
    expect(await findContadorLink(l.token, now)).toMatchObject({ profileName: "Contador" });
    expect(await listContadorLinks(now)).toEqual([expect.objectContaining({ id: row.id, createdByName: "G" })]);
  });

  it("quem não pode dar as permissões do Contador não gera (mesma regra de convidar)", async () => {
    // Um perfil que gere a equipe mas não vê valores nem relatórios.
    const { id: chefe } = await saveProfile({ name: "Chefe de equipe", permissions: ["equipe.gerir", "atendimento.ver"] }, g);
    const c = (await db.insert(users).values({ name: "Chefe", email: "chefe@c.com", role: "gestor", passwordHash: "x", profileId: chefe }).returning())[0].id;
    await expect(createContadorLink(c)).rejects.toThrow(/permissão que você não tem/);
    expect(await db.select().from(openInvites)).toHaveLength(0);
  });

  it("nunca gera link de gestão: com o perfil Contador mexido para gerir a equipe, recusa", async () => {
    await db.update(profiles).set({ permissions: sql`array_append(${profiles.permissions}, 'equipe.gerir')` }).where(eq(profiles.id, contador));
    await expect(createContadorLink(g)).rejects.toThrow(/não pode gerir a equipe/);
  });
});

describe("link do contador: usar", () => {
  it("cria o acesso com o perfil Contador, entra em Relatórios e o link deixa de valer", async () => {
    const { token } = await createContadorLink(g);
    const u = await acceptContadorLink(token, form({ email: " Carlos@Contabil.com " }));
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ name: "Carlos Contador", email: "carlos@contabil.com", profileId: contador, active: true, role: "atendente", signature: null, availability: "ausente" });
    expect((await checkCredentials("carlos@contabil.com", "senha-do-carlos"))?.id).toBe(u.id);
    expect(await inviteLanding(u.id)).toBe("/relatorios");
    const [inv] = await db.select().from(openInvites);
    expect(inv.usedAt).not.toBeNull();
    expect(inv.usedBy).toBe(u.id);
    expect(await findContadorLink(token)).toBeNull();
    expect(await listContadorLinks()).toEqual([]);
    expect((await audits("usou_link_contador"))[0]).toMatchObject({ userId: u.id, entity: "user", entityId: u.id });
    // Uso único.
    await expect(acceptContadorLink(token, form({ email: "outro@contabil.com" }))).rejects.toThrow(/expirou, já foi usado ou foi cancelado/);
    expect(await db.select().from(users).where(eq(users.email, "outro@contabil.com"))).toHaveLength(0);
  });

  it("vencido (7 dias) não vale", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const { token } = await createContadorLink(g, now);
    const later = new Date("2026-11-02T12:00:01Z");
    expect(await findContadorLink(token, later)).toBeNull();
    await expect(acceptContadorLink(token, form(), later)).rejects.toThrow(/expirou/);
    expect(await db.select().from(users).where(eq(users.email, "carlos@contabil.com"))).toHaveLength(0);
  });

  it("revogado não vale; revogar fica na auditoria e não dá para revogar duas vezes", async () => {
    const { token, id } = await createContadorLink(g);
    await revokeContadorLink(id, g);
    expect((await audits("revogou_link_contador"))[0]).toMatchObject({ userId: g, entity: "open_invite", entityId: id });
    expect(await findContadorLink(token)).toBeNull();
    await expect(acceptContadorLink(token, form())).rejects.toThrow(/cancelado/);
    await expect(revokeContadorLink(id, g)).rejects.toThrow(/já foi usado, venceu ou foi cancelado/);
    expect(await listContadorLinks()).toEqual([]);
  });

  it("e-mail já cadastrado: mensagem clara, nada criado e o link continua valendo", async () => {
    await db.insert(users).values({ name: "Bruna", email: "bruna@casa.com", role: "atendente", passwordHash: "x" });
    const { token } = await createContadorLink(g);
    await expect(acceptContadorLink(token, form({ email: "BRUNA@casa.com" }))).rejects.toThrow("Já existe um acesso com esse e-mail.");
    expect(await findContadorLink(token)).not.toBeNull();
    const u = await acceptContadorLink(token, form());
    expect(u.id).toBeTruthy();
  });

  it("nome, e-mail e senha conferidos antes de gastar o link", async () => {
    const { token } = await createContadorLink(g);
    await expect(acceptContadorLink(token, form({ password: "1234567" }))).rejects.toThrow("A senha precisa ter pelo menos 8 caracteres.");
    await expect(acceptContadorLink(token, form({ email: "nao-e-email" }))).rejects.toThrow("E-mail inválido.");
    await expect(acceptContadorLink(token, form({ name: " " }))).rejects.toThrow("Escreva o seu nome.");
    expect(await findContadorLink(token)).not.toBeNull();
  });

  it("corrida: dois envios ao mesmo tempo com o mesmo link criam UM acesso só", async () => {
    const { token } = await createContadorLink(g);
    const r = await Promise.allSettled([acceptContadorLink(token, form({ email: "a@contabil.com" })), acceptContadorLink(token, form({ email: "b@contabil.com" }))]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/expirou, já foi usado ou foi cancelado/);
    expect(await db.select().from(users).where(eq(users.profileId, contador))).toHaveLength(1);
  });

  it("corrida pelo mesmo e-mail com dois links: um acesso só, o outro recebe a mensagem de e-mail repetido e o link dele segue valendo", async () => {
    const a = await createContadorLink(g), b = await createContadorLink(g);
    const r = await Promise.allSettled([acceptContadorLink(a.token, form()), acceptContadorLink(b.token, form())]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason)).toMatch("Já existe um acesso com esse e-mail.");
    expect(await db.select().from(users).where(eq(users.email, "carlos@contabil.com"))).toHaveLength(1);
    expect(await db.select().from(openInvites).where(and(sql`${openInvites.usedAt} is null`))).toHaveLength(1);
  });

  it("perfil mexido depois de gerar (passou a gerir a equipe): o link não cria acesso", async () => {
    const { token } = await createContadorLink(g);
    await db.update(profiles).set({ permissions: sql`array_append(${profiles.permissions}, 'equipe.gerir')` }).where(eq(profiles.id, contador));
    await expect(acceptContadorLink(token, form())).rejects.toThrow(/expirou, já foi usado ou foi cancelado/);
    expect(await db.select().from(users).where(eq(users.email, "carlos@contabil.com"))).toHaveLength(0);
  });

  it("token desconhecido (ou o do convite de sempre, que mora em users) não vale como link do contador", async () => {
    expect(await findContadorLink("qualquer-coisa")).toBeNull();
    await expect(acceptContadorLink("qualquer-coisa", form())).rejects.toThrow(/expirou/);
  });
});

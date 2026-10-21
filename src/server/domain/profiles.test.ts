import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, profiles, sessions, users } from "../db/schema";
import { PERMS } from "@/lib/permissions";
import { resetDb } from "../../../test/db";
import { createMember, deleteProfile, duplicateProfile, inviteWithProfile, listProfiles, resetMemberPassword, saveProfile, setMemberActive, setMemberProfile, setMemberSignature } from "./profiles";
import { hashPassword, verifyPassword } from "../auth/password";

const pid = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0].id;
const mkUser = async (name: string, key: string, active = true) =>
  (await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, passwordHash: "x", active, profileId: await pid(key) }).returning())[0];

describe("perfis", () => {
  let g: Awaited<ReturnType<typeof mkUser>>;
  beforeEach(async () => { await resetDb(); g = await mkUser("Gestora", "gestao"); });

  it("lista os perfis com quantas pessoas usam cada um", async () => {
    await mkUser("Ana", "atendente");
    const rows = await listProfiles();
    expect(rows.find((p) => p.key === "gestao")!.members).toBe(1);
    expect(rows.find((p) => p.key === "atendente")!.members).toBe(1);
    expect(rows.find((p) => p.key === "recepcao")!.members).toBe(0);
  });

  it("a contagem inclui quem está desativado (é o mesmo número que trava o Apagar)", async () => {
    await mkUser("Ex", "recepcao", false);
    expect((await listProfiles()).find((p) => p.key === "recepcao")!.members).toBe(1);
  });

  it("cria perfil, descarta permissão desconhecida e grava na auditoria", async () => {
    const { id } = await saveProfile({ name: "Só fila", permissions: ["atendimento.ver", "x.velha"] }, g.id);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, id));
    expect(row.permissions).toEqual(["atendimento.ver"]);
    expect(row.isSystem).toBe(false);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, id)))[0].action).toBe("perfil_criado");
  });

  it("nome repetido (sem diferenciar maiúscula) é recusado", async () => {
    await expect(saveProfile({ name: "recepção", permissions: [] }, g.id)).rejects.toThrow("Já existe um perfil com esse nome");
  });

  it("nome curto é recusado", async () => {
    await expect(saveProfile({ name: "A", permissions: [] }, g.id)).rejects.toThrow();
  });

  it("perfil Gestão pode ligar ou desligar só o rodízio de leads", async () => {
    const gestao = await pid("gestao");
    await saveProfile({ id: gestao, name: "Gestão", permissions: [...PERMS] }, g.id);
    expect((await db.select().from(profiles).where(eq(profiles.id, gestao)))[0].permissions).toContain("distribuicao.receber");
    await saveProfile({ id: gestao, name: "Gestão", permissions: PERMS.filter((p) => p !== "distribuicao.receber") }, g.id);
    expect((await db.select().from(profiles).where(eq(profiles.id, gestao)))[0].permissions).not.toContain("distribuicao.receber");
  });

  it("perfil Gestão não perde permissão", async () => {
    await expect(saveProfile({ id: await pid("gestao"), name: "Gestão", permissions: ["atendimento.ver"] }, g.id)).rejects.toThrow("sempre tem acesso a tudo");
    const [row] = await db.select().from(profiles).where(eq(profiles.key, "gestao"));
    expect([...row.permissions].sort()).toEqual(PERMS.filter((p) => !["distribuicao.receber", "mensagem.massa", "pro.app", "pro.ganhos"].includes(p)).sort()); // massa (Lote 5) e app da profissional (Lote 7A): opcionais
  });

  it("não apaga perfil padrão nem perfil em uso", async () => {
    await expect(deleteProfile(await pid("recepcao"), g.id)).rejects.toThrow("Perfis padrão não podem ser apagados");
    const { id } = await saveProfile({ name: "Temporário", permissions: ["atendimento.ver"] }, g.id);
    const u = await mkUser("Rita", "recepcao");
    await setMemberProfile(u.id, id, g.id);
    await expect(deleteProfile(id, g.id)).rejects.toThrow("Mova as 1 pessoa");
    await setMemberProfile(u.id, await pid("recepcao"), g.id);
    await deleteProfile(id, g.id);
    expect(await db.select().from(profiles).where(eq(profiles.id, id))).toHaveLength(0);
  });

  it("duplicar cria uma cópia editável", async () => {
    const { id } = await duplicateProfile(await pid("atendente"), g.id);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, id));
    expect(row.name).toBe("Atendente (cópia)");
    expect(row.isSystem).toBe(false);
  });

  it("ninguém tira o próprio acesso de gerir a equipe", async () => {
    await expect(setMemberProfile(g.id, await pid("atendente"), g.id)).rejects.toThrow("próprio acesso de gerir a equipe");
    const { id } = await saveProfile({ name: "Gerente", permissions: ["equipe.gerir", "atendimento.ver"] }, g.id);
    const ger = await mkUser("Gil", "recepcao");
    await setMemberProfile(ger.id, id, g.id);
    // M3 (17/10): perfil com "Gerir equipe" só a Gestão edita; a gerente nem chega a tirar o próprio acesso.
    await expect(saveProfile({ id, name: "Gerente", permissions: ["atendimento.ver"] }, ger.id)).rejects.toThrow("Gestão");
  });

  it("precisa sobrar pelo menos uma pessoa ativa que gere a equipe", async () => {
    const other = await mkUser("Outra", "gestao");
    await setMemberActive(other.id, false, g.id); // ok: a Gestora continua
    await expect(setMemberActive(g.id, false, other.id)).rejects.toThrow(); // a outra está inativa e nem pode agir; e sobraria zero
  });

  it("trocar de perfil atualiza a coluna antiga (para uma volta de versão) e audita", async () => {
    const ana = await mkUser("Ana", "atendente");
    await setMemberProfile(ana.id, await pid("gestao"), g.id);
    expect((await db.select().from(users).where(eq(users.id, ana.id)))[0].role).toBe("gestor");
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, ana.id)))[0].action).toBe("perfil_trocado");
  });

  it("desativar derruba as sessões da pessoa", async () => {
    const ana = await mkUser("Ana", "atendente");
    await db.insert(sessions).values({ idHash: "h1", userId: ana.id, expiresAt: new Date(Date.now() + 86_400_000) });
    await setMemberActive(ana.id, false, g.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, ana.id))).toHaveLength(0);
  });

  it("convite grava o perfil escolhido", async () => {
    await inviteWithProfile({ name: "Bia Souza", email: "bia@c.com", profileId: await pid("recepcao") }, g.id);
    const [bia] = await db.select().from(users).where(eq(users.email, "bia@c.com"));
    expect(bia.profileId).toBe(await pid("recepcao"));
    expect(bia.role).toBe("atendente");
  });
});

/**
 * Revisão de segurança 17/10 (M3): "Gerir equipe e perfis" não vira dono do sistema. Quem não é da Gestão só concede o que tem,
 * e só a Gestão mexe no perfil Gestão e em quem gere a equipe (perfil, desativar, senha).
 */
describe("equipe.gerir sem ser da Gestão", () => {
  let g: Awaited<ReturnType<typeof mkUser>>, ger: Awaited<ReturnType<typeof mkUser>>, gerente = "";
  beforeEach(async () => {
    await resetDb();
    g = await mkUser("Gestora", "gestao");
    gerente = (await saveProfile({ name: "Gerente", permissions: ["equipe.gerir", "atendimento.ver", "contatos.ver"] }, g.id)).id;
    ger = await mkUser("Gil", "recepcao");
    await setMemberProfile(ger.id, gerente, g.id);
  });

  it("não concede permissão que não tem: perfil novo, perfil editado e duplicar a Gestão", async () => {
    await expect(saveProfile({ name: "Tudo", permissions: ["atendimento.ver", "config.sistema"] }, ger.id)).rejects.toThrow("permissão que você não tem");
    const { id } = await saveProfile({ name: "Só fila", permissions: ["atendimento.ver"] }, ger.id);
    await expect(saveProfile({ id, name: "Só fila", permissions: ["atendimento.ver", "valores.ver"] }, ger.id)).rejects.toThrow("permissão que você não tem");
    // O próprio perfil de gerente (tem "Gerir equipe"): nem chega a conceder, só a Gestão edita.
    await expect(saveProfile({ id: gerente, name: "Gerente", permissions: ["equipe.gerir", "atendimento.ver", "contatos.ver", "caixa.gerir"] }, ger.id)).rejects.toThrow("Gestão");
    await expect(duplicateProfile(await pid("gestao"), ger.id)).rejects.toThrow("permissão que você não tem");
    // Tirar o que já estava no perfil (e ele não tem) continua valendo: não é conceder.
    await expect(saveProfile({ id: await pid("recepcao"), name: "Recepção", permissions: ["atendimento.ver"] }, ger.id)).resolves.toBeTruthy();
  });

  it("não põe ninguém (nem a si) num perfil com permissão que não tem, nem convida ou cria acesso assim", async () => {
    const ana = await mkUser("Ana", "atendente");
    await expect(setMemberProfile(ana.id, await pid("recepcao"), ger.id)).rejects.toThrow("permissão que você não tem");
    await expect(setMemberProfile(ger.id, await pid("gestao"), ger.id)).rejects.toThrow("Gestão");
    await expect(inviteWithProfile({ name: "Bia Souza", email: "bia@c.com", profileId: await pid("gestao") }, ger.id)).rejects.toThrow("Gestão");
    await expect(createMember({ name: "Lia", email: "lia@c.com", password: "12345678", profileId: await pid("recepcao") }, ger.id)).rejects.toThrow("permissão que você não tem");
    const { id: soFila } = await saveProfile({ name: "Só fila", permissions: ["atendimento.ver"] }, g.id);
    await expect(setMemberProfile(ana.id, soFila, ger.id)).resolves.toBeUndefined();
  });

  it("não edita perfil de quem gere a equipe (rebaixaria outra gerente sem passar pela Gestão)", async () => {
    const gil2 = await mkUser("Gilda", "recepcao");
    await setMemberProfile(gil2.id, gerente, g.id);
    await expect(saveProfile({ id: gerente, name: "Gerente", permissions: ["atendimento.ver", "contatos.ver"] }, ger.id)).rejects.toThrow("Gestão");
    await expect(deleteProfile(gerente, ger.id)).rejects.toThrow();
  });

  it("não troca a assinatura da dona (é como as mensagens dela saem)", async () => {
    await expect(setMemberSignature(g.id, "OUTRA", ger.id)).rejects.toThrow("Gestão");
  });

  it("não mexe no perfil Gestão", async () => {
    await expect(saveProfile({ id: await pid("gestao"), name: "Gestão", permissions: [...PERMS] }, ger.id)).rejects.toThrow("Gestão");
  });

  it("não mexe em quem é da Gestão (a dona): perfil, desativar e senha", async () => {
    await expect(setMemberProfile(g.id, gerente, ger.id)).rejects.toThrow("Gestão");
    await expect(setMemberActive(g.id, false, ger.id)).rejects.toThrow("Gestão");
    await db.update(users).set({ passwordHash: await hashPassword("senha-do-gil") }).where(eq(users.id, ger.id));
    await expect(resetMemberPassword(g.id, "senha-nova-123", ger.id, "senha-do-gil")).rejects.toThrow("Gestão");
    expect((await db.select().from(users).where(eq(users.id, g.id)))[0].active).toBe(true);
  });

  it("a Gestão continua podendo tudo: conceder o que é opcional para ela (app da profissional) e mexer em quem gere", async () => {
    const ana = await mkUser("Ana", "atendente");
    await expect(setMemberProfile(ana.id, await pid("profissional"), g.id)).resolves.toBeUndefined();
    await expect(setMemberActive(ger.id, false, g.id)).resolves.toBeUndefined();
  });
});

describe("trocar a senha de alguém pede a senha de quem troca (M3)", () => {
  beforeEach(async () => { await resetDb(); });
  it("sem a senha certa de quem troca, nada muda; com ela, troca", async () => {
    const g = await mkUser("Gestora", "gestao");
    await db.update(users).set({ passwordHash: await hashPassword("senha-da-gestora") }).where(eq(users.id, g.id));
    const ana = await mkUser("Ana", "atendente");
    await expect(resetMemberPassword(ana.id, "senha-nova-123", g.id, "errada-123")).rejects.toThrow("Sua senha não confere");
    await expect(resetMemberPassword(ana.id, "senha-nova-123", g.id, "")).rejects.toThrow("Sua senha não confere");
    expect((await db.select().from(users).where(eq(users.id, ana.id)))[0].passwordHash).toBe("x");
    await resetMemberPassword(ana.id, "senha-nova-123", g.id, "senha-da-gestora");
    expect(await verifyPassword((await db.select().from(users).where(eq(users.id, ana.id)))[0].passwordHash, "senha-nova-123")).toBe(true);
  });
});

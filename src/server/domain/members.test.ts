import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, profiles, sessions, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { checkCredentials } from "../auth/users";
import { hashPassword } from "../auth/password";
import { createMember, inviteWithProfile, resetMemberPassword, setMemberSignature } from "./profiles";

let g = "", recepcao = "";
beforeEach(async () => {
  await resetDb();
  // Quem age é da Gestão (M3, 17/10: o domínio confere o perfil de quem concede e a senha de quem troca a senha de alguém).
  const gestao = (await db.select().from(profiles).where(eq(profiles.key, "gestao")))[0].id;
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: await hashPassword("senha-da-gestora"), profileId: gestao }).returning())[0].id;
  recepcao = (await db.select().from(profiles).where(eq(profiles.key, "recepcao")))[0].id;
});

describe("criar acesso direto (sem convite)", () => {
  it("a gestão cria nome, e-mail, senha e perfil; a pessoa já entra com isso", async () => {
    const u = await createMember({ name: "Bruna Lima", email: " Bruna@Casa.com ", password: "senha-da-bruna", profileId: recepcao }, g);
    expect(u.email).toBe("bruna@casa.com");
    const logged = await checkCredentials("bruna@casa.com", "senha-da-bruna");
    expect(logged?.id).toBe(u.id);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ profileId: recepcao, active: true, role: "atendente" });
  });
  it("e-mail repetido, senha curta ou perfil inexistente dão mensagem clara", async () => {
    await createMember({ name: "Bruna", email: "b@c.com", password: "12345678", profileId: recepcao }, g);
    await expect(createMember({ name: "Outra", email: "B@C.com", password: "12345678", profileId: recepcao }, g)).rejects.toThrow("Já existe alguém com esse e-mail");
    await expect(createMember({ name: "Lia", email: "lia@c.com", password: "123", profileId: recepcao }, g)).rejects.toThrow("8 caracteres");
    await expect(createMember({ name: "Lia", email: "lia@c.com", password: "12345678", profileId: "00000000-0000-4000-8000-000000000000" }, g)).rejects.toThrow("perfil");
  });
  it("trocar a senha de alguém: a antiga para de valer e as sessões abertas caem", async () => {
    const u = await createMember({ name: "Bruna", email: "b@c.com", password: "senha-antiga", profileId: recepcao }, g);
    await db.insert(sessions).values({ idHash: "t", userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) });
    await resetMemberPassword(u.id, "senha-nova-123", g, "senha-da-gestora");
    expect(await checkCredentials("b@c.com", "senha-antiga")).toBeFalsy();
    expect((await checkCredentials("b@c.com", "senha-nova-123"))?.id).toBe(u.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });
});

describe("assinatura (Configurações › Equipe)", () => {
  it("quem entra já nasce com a assinatura do 1º nome; repetida fica sem (a gestão escolhe)", async () => {
    const bruna = await createMember({ name: "Bruna Alves", email: "b@c.com", password: "12345678", profileId: recepcao }, g);
    const outra = await createMember({ name: "Vera Quintela", email: "b2@c.com", password: "12345678", profileId: recepcao }, g);
    const sig = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0].signature;
    expect(await sig(bruna.id)).toBe("BRUNA");
    expect(await sig(outra.id)).toBeNull();
  });

  it("guarda em maiúsculas, recusa repetida (mesmo com acento) e inválida, vazio tira; tudo auditado", async () => {
    const sara = await createMember({ name: "Sara Lima", email: "s@c.com", password: "12345678", profileId: recepcao }, g);
    const cati = await createMember({ name: "Catarina", email: "c@c.com", password: "12345678", profileId: recepcao }, g);
    expect(await setMemberSignature(sara.id, "  sara ", g)).toEqual({ signature: "SARA" });
    await expect(setMemberSignature(cati.id, "Sára", g)).rejects.toThrow("A assinatura SÁRA já é de Sara Lima.");
    await expect(setMemberSignature(cati.id, "CATI 2", g)).rejects.toThrow("Use só letras e espaço");
    expect(await setMemberSignature(cati.id, "cati", g)).toEqual({ signature: "CATI" });
    expect(await setMemberSignature(sara.id, "   ", g)).toEqual({ signature: null });
    expect((await db.select().from(users).where(eq(users.id, cati.id)))[0].signature).toBe("CATI");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "assinatura_alterada"))).toHaveLength(3);
  });
});

describe("convite", () => {
  it("quem é convidada também nasce com a assinatura do 1º nome", async () => {
    const [p] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
    const [gp] = await db.select().from(profiles).where(eq(profiles.key, "gestao"));
    const [g] = await db.insert(users).values({ name: "Gestora", email: "gg@c.com", role: "gestor", passwordHash: "x", profileId: gp.id }).returning();
    await inviteWithProfile({ name: "Lívia Prado", email: "l@c.com", profileId: p.id }, g.id);
    expect((await db.select().from(users).where(eq(users.email, "l@c.com")))[0].signature).toBe("LÍVIA");
  });
});

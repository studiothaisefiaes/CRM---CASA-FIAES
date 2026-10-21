import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, professionals, profiles, pushSubscriptions, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { hashToken } from "../../auth/tokens";
import { acceptInvite, findInvite, inviteLanding } from "../../auth/users";
import { findSessionUser, insertSession } from "../../auth/sessions-store";
import { resolvePro } from "../../queries/pro";
import { updateProfessional } from "../professionals";
import { inviteProfessional, proAccessList, regenerateProInvite, revokeProAccess } from "./access";

let gestora = "";
const tokenOf = (url: string) => url.split("/convite/")[1];
const pro = async (name = "MAIARA") => (await db.insert(professionals).values({ name, fullName: `${name[0]}${name.slice(1).toLowerCase()} Lima` }).returning())[0];

beforeEach(async () => {
  await resetDb();
  gestora = (await db.insert(users).values({ name: "Thaíse Fiaes", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
});

describe("convite da profissional (seção 8.4.8)", () => {
  it("cria a usuária com o perfil Profissional, liga à profissional e devolve o link (no banco, só o hash)", async () => {
    const p = await pro();
    const r = await inviteProfessional(p.id, " Maiara@Exemplo.com ", gestora);
    expect(r.url).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(r.text).toMatch(/^Oi, Maiara!/);
    expect(r.text).toContain(r.url);
    const [u] = await db.select().from(users).where(eq(users.email, "maiara@exemplo.com"));
    const [prof] = await db.select().from(profiles).where(eq(profiles.key, "profissional"));
    expect(u).toMatchObject({ profileId: prof.id, role: "atendente", active: true, inviteTokenHash: hashToken(tokenOf(r.url)), passwordHash: null });
    expect((await db.select().from(professionals).where(eq(professionals.id, p.id)))[0].userId).toBe(u.id);
    expect(await resolvePro(u.id)).toMatchObject({ professionalId: p.id, name: "MAIARA" });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "convidou_profissional"))).toHaveLength(1);
  });

  it("e-mail de outra pessoa da equipe é recusado com o nome dela", async () => {
    await db.insert(users).values({ name: "Helena Henriques", email: "cati@c.com", role: "gestor", passwordHash: "x" });
    const p = await pro();
    await expect(inviteProfessional(p.id, "CATI@c.com", gestora)).rejects.toThrow("Esse e-mail já é de Caticilene. Use outro.");
  });

  it("e-mail já ligado a outra profissional é recusado; profissional desativada não recebe convite", async () => {
    const a = await pro("ANA");
    const b = await pro("BIA");
    await inviteProfessional(a.id, "ana@c.com", gestora);
    await expect(inviteProfessional(b.id, "ana@c.com", gestora)).rejects.toThrow(/^Esse e-mail já é de /);
    await db.update(professionals).set({ active: false }).where(eq(professionals.id, b.id));
    await expect(inviteProfessional(b.id, "bia@c.com", gestora)).rejects.toThrow("Essa profissional está desativada. Reative antes de dar acesso.");
  });

  it("aceitar grava 'aceitou_convite', leva para /pro/instalar e a lista mostra que entrou", async () => {
    const p = await pro();
    const r = await inviteProfessional(p.id, "maiara@c.com", gestora);
    const u = await acceptInvite(tokenOf(r.url), "senha-boa-123");
    expect(await inviteLanding(u.id)).toBe("/pro/instalar");
    expect(await inviteLanding(gestora)).toBe("/");
    const list = await proAccessList();
    expect(list[p.id]).toMatchObject({ userId: u.id, email: "maiara@c.com", active: true, invitePending: false, devices: 0 });
    expect(list[p.id].enteredAt).not.toBeNull();
  });

  it("gerar novo link: o antigo deixa de valer", async () => {
    const p = await pro();
    const r1 = await inviteProfessional(p.id, "maiara@c.com", gestora);
    const r2 = await regenerateProInvite(p.id, gestora);
    expect(await findInvite(tokenOf(r1.url))).toBeNull();
    expect(await findInvite(tokenOf(r2.url))).not.toBeNull();
  });

  it("tirar acesso: inativa, a sessão cai na hora, os aparelhos de aviso saem e o convite morre; a ligação fica para o histórico", async () => {
    const p = await pro();
    const r = await inviteProfessional(p.id, "maiara@c.com", gestora);
    const u = await acceptInvite(tokenOf(r.url), "senha-boa-123");
    const { token } = await insertSession(u.id);
    await db.insert(pushSubscriptions).values({ userId: u.id, endpoint: "https://fcm.googleapis.com/fcm/send/x1", p256dh: "k", auth: "a" });
    await revokeProAccess(p.id, gestora);
    expect(await findSessionUser(token)).toBeNull();
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id))).toHaveLength(0);
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0]).toMatchObject({ active: false, inviteTokenHash: null });
    expect((await db.select().from(professionals).where(eq(professionals.id, p.id)))[0].userId).toBe(u.id);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "tirou_acesso_profissional"))).toHaveLength(1);
    await inviteProfessional(p.id, "maiara@c.com", gestora); // "Dar acesso de novo" com o mesmo e-mail
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0].active).toBe(true);
  });

  it("desativar a profissional tira o acesso (a sessão cai) e o app deixa de achar a ligação", async () => {
    const p = await pro();
    const r = await inviteProfessional(p.id, "maiara@c.com", gestora);
    const u = await acceptInvite(tokenOf(r.url), "senha-boa-123");
    const { token } = await insertSession(u.id);
    await updateProfessional(p.id, { active: false }, gestora);
    expect(await findSessionUser(token)).toBeNull();
    expect(await resolvePro(u.id)).toBeNull();
  });

  it("sem ligação, o app não acha profissional", async () => {
    expect(await resolvePro(gestora)).toBeNull();
  });
});

/** Revisão de segurança 17/10 (M3): o "Acesso ao app" não é um caminho lateral para tomar a conta de quem é da Gestão. */
describe("acesso ao app de quem é da Gestão", () => {
  it("quem gere a equipe sem ser da Gestão não gera link novo nem tira o acesso da dona ligada a uma profissional; a Gestão pode", async () => {
    const pid = async (key: string) => (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, key)))[0].id;
    const [gerenteP] = await db.insert(profiles).values({ name: "Gerente", permissions: ["equipe.gerir", "config.diaadia"] }).returning();
    const ger = (await db.insert(users).values({ name: "Gil", email: "gil@c.com", passwordHash: "x", profileId: gerenteP.id }).returning())[0].id;
    const dona = (await db.insert(users).values({ name: "Thaíse", email: "t@c.com", passwordHash: "x", profileId: await pid("gestao") }).returning())[0].id;
    const g2 = (await db.insert(users).values({ name: "Gestora 2", email: "g2@c.com", passwordHash: "x", profileId: await pid("gestao") }).returning())[0].id;
    const p = await pro("THAISE");
    await db.update(professionals).set({ userId: dona }).where(eq(professionals.id, p.id));
    await expect(regenerateProInvite(p.id, ger)).rejects.toThrow("Gestão");
    await expect(revokeProAccess(p.id, ger)).rejects.toThrow("Gestão");
    expect((await db.select().from(users).where(eq(users.id, dona)))[0]).toMatchObject({ active: true, inviteTokenHash: null });
    await expect(regenerateProInvite(p.id, g2)).resolves.toBeTruthy();
  });
});

describe("escalada: quem gere a equipe mas não é da Gestão (QA r66, C-2)", () => {
  it("convidar, gerar link e tirar acesso na profissional ligada à dona são recusados e nada muda", async () => {
    const [perfil] = await db.insert(profiles).values({ name: "Gerente", permissions: ["equipe.gerir"] }).returning();
    const gerente = (await db.insert(users).values({ name: "Gerente", email: "ger@c.com", role: "atendente", profileId: perfil.id, passwordHash: "x" }).returning())[0].id;
    const [gestao] = await db.select().from(profiles).where(eq(profiles.key, "gestao"));
    const dona = (await db.insert(users).values({ name: "Dona", email: "dona@c.com", role: "gestor", profileId: gestao.id, passwordHash: "x" }).returning())[0];
    const p = (await db.insert(professionals).values({ name: "DONA", userId: dona.id }).returning())[0];
    await expect(inviteProfessional(p.id, "dona@c.com", gerente)).rejects.toThrow(/Gestão/);
    await expect(regenerateProInvite(p.id, gerente)).rejects.toThrow(/Gestão/);
    await expect(revokeProAccess(p.id, gerente)).rejects.toThrow(/Gestão/);
    const [after] = await db.select().from(users).where(eq(users.id, dona.id));
    expect(after).toMatchObject({ active: true, profileId: gestao.id });
  });
});

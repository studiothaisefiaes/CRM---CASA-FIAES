import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { appointments, auditLog, clientNotes, contacts, lists, professionals, professionalServices, settings, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { listMyServices, resolvePro, type ProContext } from "../../queries/pro";
import { mediaDir } from "../../whatsapp/media";
import { changeStatus } from "../agenda/ports";
import { addClientNote, canSeeNotePhoto } from "../client-notes";
import { proAct, proAddExtras, proUndoNoShow } from "./appointment-actions";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
let k = 0;
let maiara: ProContext;
let biaId = "", paula = "", corte = "", escova = "", unha = "", gestora = "";

const ap = async (o: Partial<typeof appointments.$inferInsert> = {}) =>
  (await db.insert(appointments).values({ serviceLabel: "Corte feminino", serviceId: corte, clientName: "Paula Souza", contactId: paula, status: "agendado", origin: "crm",
    externalKey: `t:${++k}`, startsAt: bahia("2026-10-16", "10:00"), durationMin: 60, priceCents: 9000, professionalId: maiara.professionalId, ...o }).returning())[0];
const statusOf = async (id: string) => (await db.select({ s: appointments.status }).from(appointments).where(eq(appointments.id, id)))[0].s;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(bahia("2026-10-16", "10:05"));
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }, { key: "caixa_modo", value: "avec" }]);
  gestora = (await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [corte, escova, unha] = (await db.insert(lists).values([
    { kind: "service", label: "Corte feminino", durationMin: 60, priceCents: 9000 },
    { kind: "service", label: "Escova", durationMin: 40, priceCents: 5000 },
    { kind: "service", label: "Unha", durationMin: 40, priceCents: 3000 },
  ]).returning()).map((r) => r.id);
  const [u] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [p] = await db.insert(professionals).values({ name: "MAIARA", userId: u.id }).returning();
  await db.insert(professionalServices).values([{ professionalId: p.id, serviceId: corte }, { professionalId: p.id, serviceId: escova }]);
  biaId = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  maiara = (await resolvePro(u.id))!;
  paula = (await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning())[0].id;
});
afterEach(() => { vi.useRealTimers(); });

describe("ações da profissional num horário (seção 8.4.3)", () => {
  it("Chegou → Iniciar → Finalizar pela porta do 6B, com ela como autora", async () => {
    const a = await ap();
    await proAct(maiara, a.id, "chegou");
    expect(await statusOf(a.id)).toBe("chegou");
    await proAct(maiara, a.id, "iniciar");
    expect(await statusOf(a.id)).toBe("em_atendimento");
    expect(await proAct(maiara, a.id, "finalizar")).toEqual({ changed: true, comanda: "desligada" });
    expect(await statusOf(a.id)).toBe("compareceu");
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, a.id)));
    expect(log.every((l) => l.userId === maiara.userId)).toBe(true);
  });

  it("Chegou em horário de outra profissional: 'Horário não encontrado.', também direto na porta (posse dentro da transação)", async () => {
    const hers = await ap({ professionalId: biaId });
    await expect(proAct(maiara, hers.id, "chegou")).rejects.toThrow("Horário não encontrado.");
    await expect(changeStatus({ appointmentId: hers.id, status: "chegou", actorId: maiara.userId, via: "profissional", onlyProfessionalId: maiara.professionalId }))
      .rejects.toThrow("Horário não encontrado.");
    expect(await statusOf(hers.id)).toBe("agendado");
  });

  it("Faltou só 15 minutos depois do início", async () => {
    const a = await ap();
    await expect(proAct(maiara, a.id, "faltou")).rejects.toThrow("Só dá para marcar falta 15 minutos depois do horário.");
    vi.setSystemTime(bahia("2026-10-16", "10:16"));
    await proAct(maiara, a.id, "faltou");
    expect(await statusOf(a.id)).toBe("faltou");
  });

  it("Faltou com escolha 'cancelou': o horário vira Cancelado (cliente desmarcou), não Faltou (20/10)", async () => {
    const a = await ap();
    vi.setSystemTime(bahia("2026-10-16", "10:16"));
    expect((await proAct(maiara, a.id, "faltou", new Date(), { t: "cancelou", r: false })).changed).toBe(true);
    const [row] = await db.select({ s: appointments.status, r: appointments.cancelReason }).from(appointments).where(eq(appointments.id, a.id));
    expect(row).toEqual({ s: "cancelado", r: "cliente_desmarcou" });
  });

  it("Desfazer o Faltou (QA r58, M-2): volta ao status de antes; só no horário dela e só se estiver em Faltou", async () => {
    const a = await ap({ status: "confirmado" });
    const hers = await ap({ professionalId: biaId, status: "faltou" });
    vi.setSystemTime(bahia("2026-10-16", "10:16"));
    await expect(proUndoNoShow(maiara, a.id)).rejects.toThrow("Esse horário não está como falta.");
    await proAct(maiara, a.id, "faltou");
    await proUndoNoShow(maiara, a.id);
    expect(await statusOf(a.id)).toBe("confirmado");
    await expect(proUndoNoShow(maiara, hers.id)).rejects.toThrow("Horário não encontrado.");
  });

  it("caixa no CRM: Finalizar põe o serviço na comanda da visita (lançado pela profissional) e 'Fez algo a mais?' acrescenta só serviços dela", async () => {
    await db.update(settings).set({ value: "crm" }).where(eq(settings.key, "caixa_modo"));
    await db.execute(sql`insert into cash_sessions (day, status, opening_cents, opened_by) values ('2026-10-16', 'aberto', 0, ${gestora})`);
    const a = await ap({ status: "em_atendimento" });
    expect((await proAct(maiara, a.id, "finalizar")).comanda).toBe("alimentada");
    expect(await proAddExtras(maiara, a.id, [escova, unha])).toBe("alimentada"); // Unha não é dela: fica de fora
    const items = (await db.execute(sql`select label, appointment_id, professional_id, unit_cents, added_via from comanda_items where cancelled_at is null order by created_at`)).rows;
    expect(items).toEqual([
      { label: "Corte feminino", appointment_id: a.id, professional_id: maiara.professionalId, unit_cents: 9000, added_via: "profissional" },
      { label: "Escova", appointment_id: null, professional_id: maiara.professionalId, unit_cents: 5000, added_via: "profissional" },
    ]);
  });

  it("0084: 'Fez algo a mais?' usa o preço próprio dela no serviço (a lista do app mostra o mesmo) e não esbarra no motivo de mudança de preço", async () => {
    await db.update(settings).set({ value: "crm" }).where(eq(settings.key, "caixa_modo"));
    await db.execute(sql`insert into cash_sessions (day, status, opening_cents, opened_by) values ('2026-10-16', 'aberto', 0, ${gestora})`);
    await db.update(professionalServices).set({ priceCents: 7000 }).where(and(eq(professionalServices.professionalId, maiara.professionalId), eq(professionalServices.serviceId, escova)));
    expect((await listMyServices(maiara)).find((s) => s.id === escova)).toMatchObject({ priceCents: 7000 });
    const a = await ap({ status: "em_atendimento" });
    expect((await proAct(maiara, a.id, "finalizar")).comanda).toBe("alimentada");
    expect(await proAddExtras(maiara, a.id, [escova])).toBe("alimentada");
    const items = (await db.execute(sql`select label, unit_cents, original_unit_cents from comanda_items where cancelled_at is null order by created_at`)).rows;
    expect(items).toEqual([{ label: "Corte feminino", unit_cents: 9000, original_unit_cents: 9000 }, { label: "Escova", unit_cents: 7000, original_unit_cents: 7000 }]);
  });

  it("caixa no CRM e visita já paga antes (7.9): Finalizar não cobra de novo; 'a mais' vai numa comanda nova só com o extra", async () => {
    await db.update(settings).set({ value: "crm" }).where(eq(settings.key, "caixa_modo"));
    await db.execute(sql`insert into cash_sessions (day, status, opening_cents, opened_by) values ('2026-10-16', 'aberto', 0, ${gestora})`);
    const a = await ap({ status: "em_atendimento" });
    await db.execute(sql`insert into comandas (id, day, number, status, client_name, opened_by, closed_at) values (gen_random_uuid(), '2026-10-15', 1, 'fechada', 'Paula Souza', ${gestora}, now())`);
    await db.execute(sql`insert into comanda_items (comanda_id, kind, label, professional_id, qty, unit_cents, total_cents, appointment_id)
      select id, 'servico', 'Corte feminino', ${maiara.professionalId}, 1, 9000, 9000, ${a.id} from comandas`);
    expect((await proAct(maiara, a.id, "finalizar")).comanda).toBe("alimentada");
    expect((await db.execute(sql`select count(*)::int as n from comandas where status = 'aberta'`)).rows[0]).toEqual({ n: 0 });
    expect(await proAddExtras(maiara, a.id, [escova])).toBe("alimentada");
    const open = (await db.execute(sql`select ci.label, ci.appointment_id from comanda_items ci join comandas c on c.id = ci.comanda_id where c.status = 'aberta' and ci.cancelled_at is null`)).rows;
    expect(open).toEqual([{ label: "Escova", appointment_id: null }]);
  });

  it("'Fez algo a mais?' só depois de finalizar", async () => {
    const a = await ap({ status: "em_atendimento" });
    await expect(proAddExtras(maiara, a.id, [escova])).rejects.toThrow("Finalize o atendimento antes de acrescentar serviços.");
  });
});

describe("anotações da ficha técnica (seções 8.1 e 8.3)", () => {
  it("grava na ficha da cliente com a foto conferida pelos bytes; nada de telefone", async () => {
    const a = await ap();
    const { id } = await addClientNote({ appointmentId: a.id, body: "  Alérgica a amônia  ", photo: { data: JPEG } }, { userId: maiara.userId, professionalId: maiara.professionalId });
    const [n] = await db.select().from(clientNotes).where(eq(clientNotes.id, id));
    expect(n).toMatchObject({ contactId: paula, authorId: maiara.userId, professionalId: maiara.professionalId, appointmentId: a.id, body: "Alérgica a amônia", mediaMime: "image/jpeg" });
    expect(n.mediaPath).toBe(`notas/${id}.jpg`);
    expect(existsSync(path.join(mediaDir(), n.mediaPath!))).toBe(true);
  });

  it("horário de outra profissional, texto vazio ou longo, arquivo que não é foto e cliente sem ficha: recusados", async () => {
    const hers = await ap({ professionalId: biaId });
    const a = await ap();
    const semFicha = await ap({ contactId: null });
    const me = { userId: maiara.userId, professionalId: maiara.professionalId };
    await expect(addClientNote({ appointmentId: hers.id, body: "x" }, me)).rejects.toThrow("Horário não encontrado.");
    await expect(addClientNote({ appointmentId: a.id, body: "   " }, me)).rejects.toThrow("Escreva a anotação.");
    await expect(addClientNote({ appointmentId: a.id, body: "x".repeat(2001) }, me)).rejects.toThrow("Use até 2.000 caracteres.");
    await expect(addClientNote({ appointmentId: a.id, body: "ok", photo: { data: Buffer.from("%PDF-1.4") } }, me)).rejects.toThrow("Envie uma foto (JPEG, PNG, WebP ou HEIC).");
    await expect(addClientNote({ appointmentId: a.id, body: "ok", photo: { data: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff) } }, me)).rejects.toThrow("A foto passa de 5 MB. Escolha uma menor.");
    await expect(addClientNote({ appointmentId: semFicha.id, body: "ok" }, me)).rejects.toThrow("Essa cliente ainda não tem ficha no CRM: não dá para anotar.");
    expect(await db.select().from(clientNotes)).toHaveLength(0);
  });

  it("a recepção anota em qualquer horário ('Anotar para a profissional'); a nota fica para a profissional do horário", async () => {
    const hers = await ap({ professionalId: biaId });
    const { id } = await addClientNote({ appointmentId: hers.id, body: "Prefere água sem gás" }, { userId: gestora, professionalId: null });
    expect((await db.select().from(clientNotes).where(eq(clientNotes.id, id)))[0].professionalId).toBe(biaId);
  });

  it("foto: a profissional só vê de cliente com horário com ela entre 60 dias atrás e 60 dias à frente", async () => {
    const now = bahia("2026-10-16", "10:05");
    expect(await canSeeNotePhoto(maiara.userId, paula, now)).toBe(false);
    await ap({ startsAt: bahia("2026-08-01", "10:00") }); // 76 dias atrás
    expect(await canSeeNotePhoto(maiara.userId, paula, now)).toBe(false);
    await ap({ startsAt: bahia("2026-12-10", "10:00") }); // 55 dias à frente
    expect(await canSeeNotePhoto(maiara.userId, paula, now)).toBe(true);
  });
});

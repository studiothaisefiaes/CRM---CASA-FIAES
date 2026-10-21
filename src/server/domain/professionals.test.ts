import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, deals, lists, professionalServices, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { createProfessional, listProfessionals, setAppearance, setProfessionalService, setWorkHours, updateProfessional } from "./professionals";
import type { WorkHours } from "@/lib/work-hours";
import { scheduleDeal } from "./updates";

let g = "", escova = "", unha = "";
const NOW = new Date(Date.UTC(2026, 9, 14, 15, 0));
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [escova, unha] = (await db.insert(lists).values([{ kind: "service", label: "Escova X", position: 90 }, { kind: "service", label: "Unha X", position: 91 }]).returning()).map((l) => l.id);
});
async function lead(name: string) {
  const [st] = await db.select().from(stages).where(eq(stages.kind, "atendimento"));
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+557199990${Math.floor(Math.random() * 1e5)}` }).returning();
  return (await db.insert(deals).values({ contactId: c.id, stageId: st.id }).returning())[0].id;
}

describe("profissionais", () => {
  it("cadastra com os serviços que faz; lista em ordem alfabética só as ativas por padrão", async () => {
    const carla = await createProfessional({ name: " Carla ", serviceIds: [escova] }, g);
    await createProfessional({ name: "Bia", serviceIds: [unha, escova] }, g);
    expect((await listProfessionals()).map((p) => [p.name, p.serviceIds.length])).toEqual([["Bia", 2], ["Carla", 1]]);
    await updateProfessional(carla.id, { active: false }, g);
    expect((await listProfessionals()).map((p) => p.name)).toEqual(["Bia"]);
    expect((await listProfessionals({ all: true })).map((p) => p.name)).toEqual(["Bia", "Carla"]);
  });
  it("só aceita serviço da lista de Serviços; nome é obrigatório", async () => {
    const [motivo] = await db.select().from(lists).where(eq(lists.kind, "lost_reason")).limit(1);
    await expect(createProfessional({ name: "X", serviceIds: [motivo.id] }, g)).rejects.toThrow("serviço");
    await expect(createProfessional({ name: "  ", serviceIds: [] }, g)).rejects.toThrow("nome");
  });
  it("apelido (nome de tela), nome completo e cargo: cadastra, edita e apaga com campo vazio", async () => {
    const p = await createProfessional({ name: "MAIARA", fullName: "  Maiara da Silva  Santana ", role: "Cabeleireira", serviceIds: [] }, g);
    expect(p).toMatchObject({ name: "MAIARA", fullName: "Maiara da Silva Santana", role: "Cabeleireira" });
    await updateProfessional(p.id, { fullName: "", role: "Manicure" }, g);
    expect((await listProfessionals())[0]).toMatchObject({ name: "MAIARA", fullName: null, role: "Manicure" });
    await expect(updateProfessional(p.id, { role: "x".repeat(61) }, g)).rejects.toThrow("cargo");
    await expect(updateProfessional(p.id, { fullName: "x".repeat(121) }, g)).rejects.toThrow("nome completo");
  });
  it("período de repasse (Fase A): mensal por padrão, muda com de/para na auditoria e só aceita os três", async () => {
    const p = await createProfessional({ name: "Carla", serviceIds: [] }, g);
    expect((await listProfessionals())[0].payoutPeriod).toBe("mensal");
    await updateProfessional(p.id, { payoutPeriod: "quinzenal" }, g);
    expect((await listProfessionals())[0].payoutPeriod).toBe("quinzenal");
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.action, "profissional_repasse"), eq(auditLog.entityId, p.id)));
    expect(a.data).toEqual({ de: "mensal", para: "quinzenal" });
    await expect(updateProfessional(p.id, { payoutPeriod: "anual" as never }, g)).rejects.toThrow("Escolha Mensal, Quinzenal ou Semanal.");
  });
  it("editar troca nome e serviços", async () => {
    const p = await createProfessional({ name: "Carla", serviceIds: [escova] }, g);
    await updateProfessional(p.id, { name: "Carla Souza", serviceIds: [unha] }, g);
    expect((await listProfessionals())[0]).toMatchObject({ name: "Carla Souza", serviceIds: [unha] });
  });
});

describe("agendar com serviço e profissional", () => {
  it("grava serviço e profissional no lead", async () => {
    const p = await createProfessional({ name: "Carla", serviceIds: [escova] }, g);
    const d = await lead("Rita");
    await scheduleDeal(d, at(15, 10), g, NOW, { serviceId: escova, professionalId: p.id });
    const [row] = await db.select().from(deals).where(eq(deals.id, d));
    expect(row).toMatchObject({ serviceId: escova, professionalId: p.id });
  });
  it("profissional que não faz o serviço é recusada (quando o serviço já tem quem faz)", async () => {
    await createProfessional({ name: "Bia", serviceIds: [unha] }, g);
    const p = await createProfessional({ name: "Carla", serviceIds: [escova] }, g);
    await expect(scheduleDeal(await lead("Rita"), at(15, 10), g, NOW, { serviceId: unha, professionalId: p.id })).rejects.toThrow("não faz");
  });
  it("avisa (sem impedir) quando a profissional já tem horário a menos de 1 hora", async () => {
    const p = await createProfessional({ name: "Carla", serviceIds: [escova] }, g);
    await scheduleDeal(await lead("Rita"), at(15, 10), g, NOW, { serviceId: escova, professionalId: p.id });
    const r = await scheduleDeal(await lead("Sol"), at(15, 10, 30), g, NOW, { serviceId: escova, professionalId: p.id });
    expect(r.conflicts).toEqual([{ name: "Rita", at: at(15, 10).toISOString() }]);
    const free = await scheduleDeal(await lead("Lia"), at(15, 14), g, NOW, { serviceId: escova, professionalId: p.id });
    expect(free.conflicts).toEqual([]);
  });

  it("serviço que ainda não tem ninguém cadastrado (ex.: Método Fiaes): qualquer profissional ativa pode", async () => {
    const metodo = (await db.insert(lists).values({ kind: "service", label: "Método Fiaes X", position: 92 }).returning())[0].id;
    const p = await createProfessional({ name: "Ana", serviceIds: [escova] }, g);
    await expect(scheduleDeal(await lead("Rita"), at(15, 10), g, NOW, { serviceId: metodo, professionalId: p.id })).resolves.toBeTruthy();
  });
});

const semana = (over: Partial<WorkHours>): WorkHours => ({ "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, ...over });

describe("horário de trabalho, cor e ordem (Lote 6A)", () => {
  it("horário próprio grava validado; vazio volta a seguir o da Casa", async () => {
    const p = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await setWorkHours(p.id, semana({ "2": [["13:00", "18:00"], ["09:00", "12:00"]] }), g);
    expect((await listProfessionals())[0].workHours).toEqual(semana({ "2": [["09:00", "12:00"], ["13:00", "18:00"]] }));
    await setWorkHours(p.id, null, g);
    expect((await listProfessionals())[0].workHours).toBeNull();
  });
  it("horário errado é recusado com o dia e a faixa", async () => {
    const p = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await expect(setWorkHours(p.id, semana({ "2": [["09:00", "12:00"], ["13:00", "12:30"]] }), g)).rejects.toThrow("Terça, 2ª faixa: o fim precisa ser depois do início.");
    await expect(setWorkHours("00000000-0000-4000-8000-000000000000", null, g)).rejects.toThrow("Profissional não encontrada");
  });
  it("duas pessoas salvando o horário da mesma profissional: vale o último e os dois ficam na auditoria", async () => {
    const p = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    const outra = (await db.insert(users).values({ name: "R", email: "r@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
    await setWorkHours(p.id, semana({ "2": [["09:00", "18:00"]] }), g);
    await setWorkHours(p.id, semana({ "3": [["10:00", "16:00"]] }), outra);
    expect((await listProfessionals())[0].workHours).toEqual(semana({ "3": [["10:00", "16:00"]] }));
    const log = await db.select().from(auditLog).where(and(eq(auditLog.action, "horario_profissional"), eq(auditLog.entityId, p.id))).orderBy(asc(auditLog.createdAt));
    expect(log.map((l) => l.userId)).toEqual([g, outra]);
    expect(log[1].data).toEqual({ de: semana({ "2": [["09:00", "18:00"]] }), para: semana({ "3": [["10:00", "16:00"]] }) });
  });
  it("cor só da paleta e ordem de 1 a 999; a lista segue a ordem e depois o nome", async () => {
    const bia = await createProfessional({ name: "Bia", serviceIds: [] }, g);
    const cati = await createProfessional({ name: "Cati", serviceIds: [] }, g);
    await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await setAppearance(cati.id, { color: "ameixa", agendaPosition: 1 }, g);
    await setAppearance(bia.id, { agendaPosition: 2 }, g);
    expect((await listProfessionals()).map((p) => [p.name, p.color, p.agendaPosition])).toEqual([["Cati", "ameixa", 1], ["Bia", null, 2], ["Ana", null, null]]);
    await expect(setAppearance(bia.id, { color: "#ff0000" }, g)).rejects.toThrow("Escolha uma cor da paleta.");
    await expect(setAppearance(bia.id, { agendaPosition: 0 }, g)).rejects.toThrow("Use um número de 1 a 999 na ordem.");
    await setAppearance(cati.id, { color: null, agendaPosition: null }, g);
    expect((await listProfessionals()).map((p) => p.name)).toEqual(["Bia", "Ana", "Cati"]);
  });
  it("editar os serviços mantém de onde veio o vínculo que continua", async () => {
    const p = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await db.insert(professionalServices).values({ professionalId: p.id, serviceId: escova, source: "avec_historico" });
    await updateProfessional(p.id, { serviceIds: [escova, unha] }, g);
    const links = await db.select().from(professionalServices).where(eq(professionalServices.professionalId, p.id));
    expect(Object.fromEntries(links.map((l) => [l.serviceId, [l.source, l.createdBy]]))).toEqual({ [escova]: ["avec_historico", null], [unha]: ["manual", g] });
  });
  it("marcar e desmarcar um serviço de uma profissional (matriz Quem faz o quê)", async () => {
    const p = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await setProfessionalService(p.id, escova, true, g);
    await setProfessionalService(p.id, escova, true, g); // de novo: nada muda
    expect((await listProfessionals())[0].serviceIds).toEqual([escova]);
    await setProfessionalService(p.id, escova, false, g);
    expect((await listProfessionals())[0].serviceIds).toEqual([]);
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "profissional_servico"));
    expect(log.map((l) => (l.data as { faz: boolean }).faz)).toEqual([true, false]);
  });
});

describe("assistente de outra profissional (17/10: SIDNEY é assistente de THAISE)", () => {
  it("grava, lista e desfaz; recusa a própria, assistente de assistente e quem já tem assistente; fica na auditoria", async () => {
    const thaise = await createProfessional({ name: "THAISE", serviceIds: [] }, g);
    const sidney = await createProfessional({ name: "SIDNEY", serviceIds: [] }, g);
    const lia = await createProfessional({ name: "LIA", serviceIds: [] }, g);
    await updateProfessional(sidney.id, { assistantOf: thaise.id }, g);
    expect((await listProfessionals()).find((p) => p.id === sidney.id)?.assistantOf).toBe(thaise.id);
    await expect(updateProfessional(sidney.id, { assistantOf: sidney.id }, g)).rejects.toThrow("Escolha outra profissional");
    await expect(updateProfessional(lia.id, { assistantOf: sidney.id }, g)).rejects.toThrow("Sidney já é assistente de Thaise");
    await expect(updateProfessional(thaise.id, { assistantOf: lia.id }, g)).rejects.toThrow("Thaise tem assistente");
    await updateProfessional(sidney.id, { assistantOf: null }, g);
    expect((await listProfessionals()).find((p) => p.id === sidney.id)?.assistantOf).toBeNull();
    const logs = await db.select().from(auditLog).where(and(eq(auditLog.entity, "professional"), eq(auditLog.entityId, sidney.id)));
    expect(logs.some((l) => (l.data as { assistantOf?: string }).assistantOf === thaise.id)).toBe(true);
  });
});


describe("revisão final: desativar com horário em 'conferir'", () => {
  it("é recusado como os agendados (o Avec diz que tem alguém ali)", async () => {
    const { appointments } = await import("../db/schema");
    const g = (await db.select().from(users))[0]?.id ?? (await db.insert(users).values({ name: "G", email: "gg@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
    const p = await createProfessional({ name: "Zoe", serviceIds: [] }, g);
    await db.insert(appointments).values({ clientName: "Ana", professionalId: p.id, serviceLabel: "Corte", startsAt: new Date(Date.now() + 86_400_000), status: "conferir", origin: "avec", externalKey: "t:conf" });
    await expect(updateProfessional(p.id, { active: false }, g)).rejects.toThrow("remarque antes");
  });
});

describe("dados fiscais da profissional (Fase D)", () => {
  it("parceira exige CNPJ válido; CLT não; o vínculo e o CNPJ aparecem na lista e no histórico", async () => {
    const ana = await createProfessional({ name: "Ana", serviceIds: [] }, g);
    await expect(updateProfessional(ana.id, { bond: "parceira", cnpj: null }, g)).rejects.toThrow("Parceira precisa do CNPJ dela.");
    await expect(updateProfessional(ana.id, { bond: "parceira", cnpj: "11222333000180" }, g)).rejects.toThrow("CNPJ inválido.");
    await expect(updateProfessional(ana.id, { bond: "sócia" as never }, g)).rejects.toThrow("Escolha Parceira, CLT ou Outro.");
    await updateProfessional(ana.id, { bond: "clt" }, g);
    expect((await listProfessionals()).find((p) => p.id === ana.id)).toMatchObject({ bond: "clt", cnpj: null, legalName: null });
    await updateProfessional(ana.id, { bond: "parceira", cnpj: "11.222.333/0001-81", legalName: "  Ana Silva  ME " }, g);
    expect((await listProfessionals()).find((p) => p.id === ana.id)).toMatchObject({ bond: "parceira", cnpj: "11222333000181", legalName: "Ana Silva ME" });
    // Já parceira com CNPJ: trocar só a razão social não pede o CNPJ de novo; apagar o CNPJ de parceira é recusado.
    await updateProfessional(ana.id, { legalName: "Ana Silva Estética ME" }, g);
    await expect(updateProfessional(ana.id, { cnpj: null }, g)).rejects.toThrow("Parceira precisa do CNPJ dela.");
    const [l] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, ana.id), eq(auditLog.action, "editou_profissional")));
    expect(l).toBeTruthy();
  });
});

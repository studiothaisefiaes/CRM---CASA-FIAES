import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  appointments, auditLog, campaignRecipients, campaigns, clientNotes, clientPackages, clientPhotos, comandas, contactMerges, contactNotes, contactTags, contacts, dealEvents, deals,
  formAnswers, formQuestions, loyaltyEntries, loyaltyPrograms, messages, professionals, salesItems, stages, tags, users, visits,
} from "../db/schema";
import { resetDb } from "../../../test/db";
import { AVEC_H, importa, reserva } from "../../../test/avec-fixtures";
import { samePerson } from "@/lib/same-person";
import { recordInbound } from "./deals";
import { saveFuncoes } from "./funcoes";
import { mergeContacts, mergedTargetFor, previewMerge } from "./merge-contacts";

// Dados SINTÉTICOS: nomes e telefones inventados.
const NOW = new Date("2026-10-17T12:00:00Z");
const H0004 = ["Cliente", "Código", "Aniversário", "Telefone", "Celular", "E-mail", "Sexo", "Como Conheceu", "CPF", "CEP", "Endereço", "Número", "Estado", "Cidade", "Complemento", "Bairro", "Profissão", "Cadastrado", "Obs", "RG"];
const H0113 = ["Cliente", "Celular", "E-mail", "Ultima Pontuação", "Pontos Gerados", "Saldo Atual"];
const H0115 = ["Cliente", "Campo", "Slug", "Valor", "Data Cadastro"];
const cliente0004 = (nome: string, celular: number) => [nome, "", "", "", celular, "", "F", "", "", "", "", "", "", "", "", "", "", "", "", ""];

let ana: string;
let leadStage: string;
const contato = async (v: Partial<typeof contacts.$inferInsert> & { phoneE164: string }) => (await db.insert(contacts).values(v).returning())[0];
const byId = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@exemplo.test", role: "gestor", passwordHash: "x" }).returning())[0].id;
  leadStage = (await db.select().from(stages).where(eq(stages.key, "lead")))[0].id;
});

describe("unir cadastros: o que vai junto", () => {
  it("leva conversas, horários, comandas, vendas, pacotes, pontos, fichas, fotos e notas; a outra some", async () => {
    const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000501" });
    const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000502" });
    const [deal] = await db.insert(deals).values({ contactId: sai.id, stageId: leadStage, closedAt: NOW }).returning();
    await db.insert(messages).values([
      { dealId: deal.id, contactId: sai.id, direction: "in", body: "oi" },
      { dealId: deal.id, contactId: sai.id, direction: "out", body: "olá" },
    ]);
    const [v] = await db.insert(visits).values({ contactId: sai.id, day: "2026-10-10" }).returning();
    await db.insert(appointments).values({ contactId: sai.id, visitId: v.id, serviceLabel: "Corte", startsAt: new Date("2026-10-10T13:00:00Z"), status: "compareceu", origin: "crm", externalKey: "t:ap:1" });
    await db.insert(comandas).values({ contactId: sai.id, visitId: v.id, day: "2026-10-10", number: 1, status: "fechada", openedBy: ana });
    await db.insert(salesItems).values({ contactId: sai.id, soldOn: "2026-10-10", item: "Corte", kind: "servico", externalKey: "t:venda:1" });
    await db.insert(clientPackages).values({ contactId: sai.id, packageName: "Hidratação 5x", totalSessions: 5, externalKey: "t:pac:1" });
    const [prog] = await db.insert(loyaltyPrograms).values({ name: "Fiel da Fiaes", kind: "contagem", goal: 12 }).returning();
    await db.insert(loyaltyEntries).values({ contactId: sai.id, programId: prog.id, delta: 3, reason: "ajuste" });
    const [q] = await db.insert(formQuestions).values({ form: "anamnese", position: 0, label: "Tem alergia?", kind: "texto" }).returning();
    await db.insert(formAnswers).values({ contactId: sai.id, questionId: q.id, value: "Amônia" });
    await db.insert(clientPhotos).values({ contactId: sai.id, kind: "antes", mediaPath: "x/antes.jpg", mediaMime: "image/jpeg" });
    await db.insert(clientNotes).values({ contactId: sai.id, authorId: ana, body: "Prefere água morna" });
    await db.insert(contactNotes).values({ contactId: sai.id, body: "Ligou ontem" });
    const [tag] = await db.insert(tags).values({ name: "VIP" }).returning();
    await db.insert(contactTags).values([{ contactId: sai.id, tagId: tag.id }, { contactId: fica.id, tagId: tag.id }]);
    const [camp] = await db.insert(campaigns).values({ name: "Outubro", body: "oi", createdBy: ana }).returning();
    await db.insert(campaignRecipients).values([{ campaignId: camp.id, contactId: sai.id }, { campaignId: camp.id, contactId: fica.id }]);

    const prev = await previewMerge(fica.id, sai.id);
    expect(prev.blockers).toEqual([]);
    expect(prev.moving).toEqual({ conversas: 1, mensagens: 2, horarios: 1, comandas: 1, vendas: 1, pacotes: 1, pontos: 3, fichas: 1, fotos: 1, notas: 2 });

    const r = await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    expect(r.moved).toEqual(prev.moving);
    expect(await byId(sai.id)).toBeUndefined();
    for (const t of [deals, messages, visits, appointments, comandas, salesItems, clientPackages, loyaltyEntries, formAnswers, clientPhotos, clientNotes, contactNotes]) {
      const rows = await db.select().from(t);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((x) => x.contactId === fica.id)).toBe(true);
    }
    expect(await db.select().from(contactTags)).toEqual([expect.objectContaining({ contactId: fica.id, tagId: tag.id })]);
    expect((await db.select().from(campaignRecipients)).map((x) => x.contactId)).toEqual([fica.id]);
    const [m] = await db.select().from(contactMerges);
    expect(m).toMatchObject({ keptId: fica.id, droppedId: sai.id, droppedPhone: "+5571966000502", droppedName: "Rita F.", mergedBy: ana });
    const audit = (await db.select().from(auditLog)).filter((a) => a.action === "cadastros_unidos");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: fica.id, userId: ana });
  });

  it("as duas com conversa aberta: fica uma, sem perder mensagem; a outra arquivada com 'contato_mesclado'", async () => {
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    const r1 = await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571966000511", pushName: "Rita", body: "oi", at: t(30) });
    const r2 = await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "5571966000512", pushName: "Rita", body: "tem horário?", at: t(20) });
    if (!("dealId" in r1) || !("dealId" in r2)) throw new Error("sem conversa");
    const [fica] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571966000511"));
    const [sai] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571966000512"));
    // a mesma mensagem importada nos dois cadastros (ChatGuru): a da que sai perde a chave, nada é apagado
    await db.insert(messages).values([
      { dealId: r1.dealId, contactId: fica.id, direction: "in", body: "importada", importKey: "cg:1" },
      { dealId: r2.dealId, contactId: sai.id, direction: "in", body: "importada", importKey: "cg:1" },
    ]);

    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    const abertas = await db.select().from(deals).where(and(isNull(deals.closedAt), isNull(deals.archivedAt)));
    expect(abertas.map((d) => d.id)).toEqual([r1.dealId]);
    const msgs = await db.select().from(messages).where(eq(messages.dealId, r1.dealId));
    expect(msgs.map((x) => x.body).sort()).toEqual(["importada", "importada", "oi", "tem horário?"]);
    expect(msgs.filter((x) => x.importKey === "cg:1")).toHaveLength(1);
    const [arquivada] = await db.select().from(deals).where(eq(deals.id, r2.dealId));
    expect(arquivada.archivedAt).not.toBeNull();
    expect(arquivada.contactId).toBe(fica.id);
    expect(await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, r2.dealId), eq(dealEvents.type, "contato_mesclado")))).toHaveLength(1);
    expect(abertas[0].awaitingReplySince).not.toBeNull();
  });

  it("campos vazios da que fica são completados; CPF e aniversário dela não são trocados", async () => {
    const [pro] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
    const fica = await contato({
      name: "Rita Fictícia", phoneE164: "+5571966000521", cpf: "52998224725", birthDay: 10, birthMonth: 5, birthYear: 1990,
      alertNotes: "Alergia a amônia", notes: "Cliente antiga", importedFields: { avec: { codigo: "100" } },
      isClient: false, clientSince: new Date("2024-01-01T12:00:00Z"), lastServiceAt: new Date("2026-01-01T12:00:00Z"),
    });
    const sai = await contato({
      name: "Rita F.", phoneE164: "+5571966000522", cpf: "11144477735", birthDay: 1, birthMonth: 1, email: "rita@exemplo.test", instagram: "@ritaf",
      nickname: "Ritinha", hairType: "cacheado 3B", preferredProfessionalId: pro.id, imageUse: "sim", imageUseOn: "2026-02-03", waLid: "5550001",
      alertNotes: `Alergia a amônia\nNão gosta de volume\n${"x".repeat(290)}`, notes: "Veio por indicação", importedFields: { avec: { codigo: "200" } },
      isClient: true, clientSince: new Date("2023-05-01T12:00:00Z"), lastServiceAt: new Date("2026-09-01T12:00:00Z"),
    });
    const filha = await contato({ name: "Bruna F.", phoneE164: "pessoa:00000000-0000-4000-8000-000000000001", sharesPhoneWith: sai.id, phoneRelation: "filha" });

    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    const c = await byId(fica.id);
    expect(c).toMatchObject({
      name: "Rita Fictícia", cpf: "52998224725", birthDay: 10, birthMonth: 5, birthYear: 1990,
      email: "rita@exemplo.test", instagram: "@ritaf", nickname: "Ritinha", hairType: "cacheado 3B", preferredProfessionalId: pro.id,
      imageUse: "sim", imageUseOn: "2026-02-03", waLid: "5550001", importedFields: { avec: { codigo: "100" } },
      isClient: true, clientSince: new Date("2023-05-01T12:00:00Z"), lastServiceAt: new Date("2026-09-01T12:00:00Z"),
    });
    expect(c.alertNotes!.split("\n")).toEqual(["Alergia a amônia", "Não gosta de volume"]);
    expect(c.alertNotes!.length).toBeLessThanOrEqual(300);
    expect(c.notes).toContain("Cliente antiga");
    expect(c.notes).toContain("Veio por indicação");
    expect(c.notes).toContain("x".repeat(290));
    expect((await byId(filha.id)).sharesPhoneWith).toBe(fica.id);
    const [m] = await db.select().from(contactMerges);
    expect(m.droppedWaLid).toBe("5550001");
    expect(m.snapshot).toMatchObject({ contact: { cpf: "11144477735", birthDay: 1 }, avec: { codigo: "200" } });
  });
});

describe("unir cadastros: depois de unir, nada recria a que saiu", () => {
  it("mensagem nova do número que saiu cai na que ficou (resolveContact)", async () => {
    const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000531", waLid: "4440001" });
    const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000532", waLid: "4440002" });
    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    expect(await mergedTargetFor(db, "+5571966000532")).toBe(fica.id);

    const r = await recordInbound({ channelId: null, externalId: "IN9", phoneRaw: "5571966000532", pushName: "Rita", body: "oi de novo" });
    if (!("dealId" in r)) throw new Error("sem conversa");
    const r2 = await recordInbound({ channelId: null, externalId: "IN10", phoneRaw: "", lid: "4440002", pushName: "Rita", body: "pelo número oculto" });
    if (!("dealId" in r2)) throw new Error("sem conversa");
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect((await db.select().from(messages)).every((x) => x.contactId === fica.id)).toBe(true);
    expect(r2.dealId).toBe(r.dealId);
  });

  it("cadeia: unir C em A e depois A em B → mensagem do número de C cai em B", async () => {
    const a = await contato({ name: "Rita A", phoneE164: "+5571966000541" });
    const b = await contato({ name: "Rita B", phoneE164: "+5571966000542" });
    const c = await contato({ name: "Rita C", phoneE164: "+5571966000543" });
    await mergeContacts({ keepId: a.id, dropId: c.id }, ana, NOW);
    await mergeContacts({ keepId: b.id, dropId: a.id }, ana, NOW);
    expect(await mergedTargetFor(db, "+5571966000543")).toBe(b.id);
    expect(await mergedTargetFor(db, "+5571966000541")).toBe(b.id);
    await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571966000543", body: "oi" });
    expect((await db.select().from(contacts)).map((x) => x.id)).toEqual([b.id]);
    expect((await db.select().from(messages))[0].contactId).toBe(b.id);
  });

  it("reimportar o Avec (0004 e 0051 com o telefone e o nome da que saiu) não recria a cliente", async () => {
    const fica = await contato({ name: "Úrsula Vera Campos", phoneE164: "+5571966000551", importedFields: { avec: { codigo: "1" } } });
    const sai = await contato({ name: "Paulinha Rocha", phoneE164: "+5571966000552", importedFields: { avec: { codigo: "2" } } });
    expect(samePerson("Úrsula Vera Campos", "Paulinha Rocha")).toBe(false); // nomes que a importação trataria como duas pessoas
    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);

    const r1 = await importa("0004.xlsx", H0004, [cliente0004("Paulinha Rocha", 71966000552), cliente0004("Úrsula Vera Campos", 71966000551)], { now: NOW });
    expect(r1.summary.contatosNovos).toBe(0);
    const r2 = await importa("0051.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Paulinha Rocha", celular: 71966000552 })], { now: NOW });
    expect(r2.summary.contatosNovos).toBe(0);
    expect((await db.select().from(contacts)).map((x) => x.id)).toEqual([fica.id]);
    const aps = await db.select().from(appointments);
    expect(aps).toHaveLength(1);
    expect(aps[0].contactId).toBe(fica.id);
  });

  it("a 'pessoa a mais' unida ao cadastro próprio: o Avec com o número do titular e o nome dela cai no cadastro que ficou", async () => {
    const mae = await contato({ name: "Marta Teste", phoneE164: "+5571966000561", importedFields: { avec: { codigo: "10" } } });
    const pessoa = await contato({ name: "Bruna Teste", phoneE164: "pessoa:00000000-0000-4000-8000-000000000002", sharesPhoneWith: mae.id });
    const propria = await contato({ name: "Bruna Teste", phoneE164: "+5571966000562" });
    await mergeContacts({ keepId: propria.id, dropId: pessoa.id }, ana, NOW);
    const r = await importa("0051.xlsx", AVEC_H.reservas, [reserva({ dia: "20/10/2026", hora: "10:00", cliente: "Bruna Teste", celular: 71966000561 })], { now: NOW });
    expect(r.summary.contatosNovos).toBe(0);
    expect(await db.select().from(contacts)).toHaveLength(2);
    expect((await db.select().from(appointments))[0].contactId).toBe(propria.id);
  });

  it("fidelidade: as duas com saldo do Avec ficam com uma linha cada; reimportar o 0113 troca cada uma, sem duplicar nem perder", async () => {
    const [fiel] = await db.insert(loyaltyPrograms).values({ name: "Fiel da Fiaes", kind: "contagem", goal: 12 }).returning();
    const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000571" });
    const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000572" });
    const file = (a: number, b: number) => importa("0113.xlsx", H0113, [["Rita Fictícia", "71966000571", "", "10/10/2026", a, a], ["Rita F.", "71966000572", "", "10/10/2026", b, b]], { now: NOW });
    await file(5, 3);
    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    const saldo = async () => (await db.select().from(loyaltyEntries)).filter((e) => e.contactId === fica.id && e.programId === fiel.id).reduce((s, e) => s + e.delta, 0);
    expect(await saldo()).toBe(8);
    expect(await db.select().from(loyaltyEntries)).toHaveLength(2);
    await file(5, 3);
    expect(await db.select().from(loyaltyEntries)).toHaveLength(2);
    expect(await saldo()).toBe(8);
    await file(6, 4);
    expect(await db.select().from(loyaltyEntries)).toHaveLength(2);
    expect(await saldo()).toBe(10);
  });

  it("fichas: a resposta da que fica vence (a outra vai para o snapshot); reimportar o 0115 não troca nem duplica", async () => {
    const [q] = await db.insert(formQuestions).values({ form: "anamnese", position: 0, label: "Tem alergia?", kind: "texto" }).returning();
    const [q2] = await db.insert(formQuestions).values({ form: "anamnese", position: 1, label: "Usa química?", kind: "texto" }).returning();
    const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000581" });
    const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000582" });
    const file = () => importa("0115.xlsx", H0115, [
      ["Rita Fictícia", "Tem alergia?", "", "Amônia", "01/01/2024"],
      ["Rita F.", "Tem alergia?", "", "Nenhuma", "01/01/2024"],
      ["Rita F.", "Usa química?", "", "Sim", "01/01/2024"],
    ], { now: NOW });
    // a ficha do Avec é por nome: o celular vem do cadastro
    await file();
    expect(await db.select().from(formAnswers)).toHaveLength(3);
    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    const rows = async () => (await db.select().from(formAnswers)).map((a) => [a.contactId, a.questionId, a.value]).sort();
    expect(await rows()).toEqual([[fica.id, q.id, "Amônia"], [fica.id, q2.id, "Sim"]].sort());
    const [m] = await db.select().from(contactMerges);
    expect(JSON.stringify(m.snapshot)).toContain("Nenhuma");
    const r = await file();
    expect(r.summary.fichas).toBe(0);
    expect(await rows()).toEqual([[fica.id, q.id, "Amônia"], [fica.id, q2.id, "Sim"]].sort());
  });

  it("ficha apagada no CRM (vazia) da que fica não vence a resposta real da outra", async () => {
    const [q] = await db.insert(formQuestions).values({ form: "anamnese", position: 0, label: "Tem alergia?", kind: "texto" }).returning();
    const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000591" });
    const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000592" });
    await db.insert(formAnswers).values([
      { contactId: fica.id, questionId: q.id, value: "", source: "crm", externalKey: `avec:ficha:${fica.id}:${q.id}:-` },
      { contactId: sai.id, questionId: q.id, value: "Amônia", source: "crm" },
    ]);
    await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
    expect((await db.select().from(formAnswers)).map((a) => [a.contactId, a.value])).toEqual([[fica.id, "Amônia"]]);
  });
});

describe("unir cadastros: o que impede", () => {
  it("recusa: tipos diferentes; comanda aberta nas duas no mesmo dia; ficar com a 'pessoa a mais' quando a outra tem WhatsApp", async () => {
    const a = await contato({ name: "Rita A", phoneE164: "+5571966000601" });
    const equipe = await contato({ name: "Rita E", phoneE164: "+5571966000602", kind: "equipe" });
    await expect(mergeContacts({ keepId: a.id, dropId: a.id }, ana, NOW)).rejects.toThrow(/mesmo cadastro/);
    expect((await previewMerge(a.id, equipe.id)).blockers.join(" ")).toMatch(/tipos diferentes/);
    await expect(mergeContacts({ keepId: a.id, dropId: equipe.id }, ana, NOW)).rejects.toThrow(/tipos diferentes/);

    const b = await contato({ name: "Rita B", phoneE164: "+5571966000603" });
    await db.insert(comandas).values([
      { contactId: a.id, day: "2026-10-17", number: 1, status: "aberta", openedBy: ana },
      { contactId: b.id, day: "2026-10-17", number: 2, status: "aberta", openedBy: ana },
    ]);
    await expect(mergeContacts({ keepId: a.id, dropId: b.id }, ana, NOW)).rejects.toThrow(/comanda aberta/);

    const pessoa = await contato({ name: "Rita P", phoneE164: "pessoa:00000000-0000-4000-8000-000000000003", sharesPhoneWith: b.id });
    const c = await contato({ name: "Rita C", phoneE164: "+5571966000604" });
    await expect(mergeContacts({ keepId: pessoa.id, dropId: c.id }, ana, NOW)).rejects.toThrow(/WhatsApp/);
    expect(await db.select().from(contacts)).toHaveLength(5);
    expect(await db.select().from(contactMerges)).toHaveLength(0);
  });

  it("função Unir cadastros desligada: recusa (e o que já foi unido continua redirecionado)", async () => {
    const a = await contato({ name: "Rita A", phoneE164: "+5571966000611" });
    const b = await contato({ name: "Rita B", phoneE164: "+5571966000612" });
    const c = await contato({ name: "Rita C", phoneE164: "+5571966000613" });
    await mergeContacts({ keepId: a.id, dropId: b.id }, ana, NOW);
    await saveFuncoes({ unir: false }, ana);
    await expect(previewMerge(a.id, c.id)).rejects.toThrow(/desligada/);
    await expect(mergeContacts({ keepId: a.id, dropId: c.id }, ana, NOW)).rejects.toThrow(/desligada/);
    await recordInbound({ channelId: null, externalId: "IN1", phoneRaw: "5571966000612", body: "oi" });
    expect((await db.select().from(messages))[0].contactId).toBe(a.id);
  });
});

it("visitas do mesmo dia viram uma só", async () => {
  const fica = await contato({ name: "Rita Fictícia", phoneE164: "+5571966000621" });
  const sai = await contato({ name: "Rita F.", phoneE164: "+5571966000622" });
  const [vf] = await db.insert(visits).values({ contactId: fica.id, day: "2026-10-20" }).returning();
  const [vs] = await db.insert(visits).values({ contactId: sai.id, day: "2026-10-20", notes: "trazer foto" }).returning();
  const [vOutro] = await db.insert(visits).values({ contactId: sai.id, day: "2026-10-27" }).returning();
  await db.insert(appointments).values([
    { contactId: fica.id, visitId: vf.id, serviceLabel: "Corte", startsAt: new Date("2026-10-20T13:00:00Z"), status: "agendado", origin: "crm", externalKey: "t:ap:1" },
    { contactId: sai.id, visitId: vs.id, serviceLabel: "Escova", startsAt: new Date("2026-10-20T14:00:00Z"), status: "agendado", origin: "crm", externalKey: "t:ap:2" },
    { contactId: sai.id, visitId: vOutro.id, serviceLabel: "Manicure", startsAt: new Date("2026-10-27T14:00:00Z"), status: "agendado", origin: "crm", externalKey: "t:ap:3" },
  ]);
  await db.insert(comandas).values({ contactId: sai.id, visitId: vs.id, day: "2026-10-20", number: 7, status: "aberta", openedBy: ana });
  const [q] = await db.insert(formQuestions).values({ form: "consultoria", position: 0, label: "Objetivo", kind: "texto" }).returning();
  await db.insert(formAnswers).values({ contactId: sai.id, questionId: q.id, visitId: vs.id, value: "Mais leve" });
  await db.insert(clientPhotos).values({ contactId: sai.id, visitId: vs.id, kind: "depois", mediaPath: "x/depois.jpg", mediaMime: "image/jpeg" });

  await mergeContacts({ keepId: fica.id, dropId: sai.id }, ana, NOW);
  const vis = await db.select().from(visits).orderBy(visits.day);
  expect(vis.map((v) => [v.id, v.day, v.contactId])).toEqual([[vf.id, "2026-10-20", fica.id], [vOutro.id, "2026-10-27", fica.id]]);
  expect(vis[0].notes).toBe("trazer foto");
  const aps = await db.select().from(appointments).orderBy(appointments.startsAt);
  expect(aps.map((a) => a.visitId)).toEqual([vf.id, vf.id, vOutro.id]);
  expect((await db.select().from(comandas))[0].visitId).toBe(vf.id);
  expect((await db.select().from(formAnswers))[0]).toMatchObject({ contactId: fica.id, visitId: vf.id });
  expect((await db.select().from(clientPhotos))[0]).toMatchObject({ contactId: fica.id, visitId: vf.id });
});

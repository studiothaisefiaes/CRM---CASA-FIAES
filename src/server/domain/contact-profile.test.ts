import { beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, deals, professionals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { updateContactProfile } from "./contact-profile";
import { remindReturn } from "./suggested-return";
import { UserFacingError } from "./errors";
import { permsFor } from "../../../test/perms";
import { saveFuncoes } from "./funcoes";

const NOW = new Date("2026-10-15T15:00:00Z");
let ana = "", rita = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000101" }).returning())[0].id;
});
const contato = async () => (await db.select().from(contacts).where(eq(contacts.id, rita)))[0];

it("edita nome, e-mail, aniversário, anotações, avisos fixos e profissional preferida; audita só o que mudou", async () => {
  const [pro] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const r = await updateContactProfile(rita, { name: " Rita Souza ", email: "rita@exemplo.com", birthday: "17/10/1990", notes: "Prefere manhã", alertNotes: "Alérgica a amônia", preferredProfessionalId: pro.id }, ana);
  expect([...r.changed].sort()).toEqual(["alertNotes", "birthday", "email", "name", "notes", "preferredProfessionalId"]);
  expect(await contato()).toMatchObject({ name: "Rita Souza", email: "rita@exemplo.com", birthDay: 17, birthMonth: 10, birthYear: 1990, notes: "Prefere manhã", alertNotes: "Alérgica a amônia", preferredProfessionalId: pro.id });
  expect((await updateContactProfile(rita, { name: "Rita Souza", birthday: "17/10/1990" }, ana)).changed).toEqual([]);
  expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, rita), eq(auditLog.action, "atualizou_contato")))).toHaveLength(1);
});

it("aniversário que não existe, e-mail inválido e profissional apagada: erro claro e nada muda", async () => {
  await expect(updateContactProfile(rita, { birthday: "31/02" }, ana)).rejects.toThrow("Data de aniversário inválida.");
  await expect(updateContactProfile(rita, { email: "rita@" }, ana)).rejects.toBeInstanceOf(UserFacingError);
  await expect(updateContactProfile(rita, { preferredProfessionalId: "00000000-0000-4000-8000-000000000000" }, ana)).rejects.toThrow("Essa profissional não existe mais.");
  await expect(updateContactProfile(rita, { alertNotes: "x".repeat(301) }, ana)).rejects.toThrow("Use até 300 caracteres.");
  expect(await contato()).toMatchObject({ birthDay: null, email: null, preferredProfessionalId: null, alertNotes: null });
});

it("vazio apaga: aniversário, anotações e a escolha da profissional (volta para a calculada)", async () => {
  const [pro] = await db.insert(professionals).values({ name: "LUANA" }).returning();
  await updateContactProfile(rita, { birthday: "05/03", notes: "x", preferredProfessionalId: pro.id }, ana);
  await updateContactProfile(rita, { birthday: "", notes: "  ", preferredProfessionalId: "" }, ana);
  expect(await contato()).toMatchObject({ birthDay: null, birthMonth: null, birthYear: null, notes: null, preferredProfessionalId: null });
});

it("Lembrar: combinado de retorno no dia previsto às 10h para quem pediu; sem conversa aberta fica só no contato", async () => {
  const r = await remindReturn(rita, { dueOn: "2026-11-02" }, ana, NOW);
  expect(r.dueAt.toISOString()).toBe("2026-11-02T13:00:00.000Z");
  const [t] = await db.select().from(tasks).where(eq(tasks.id, r.taskId));
  expect(t).toMatchObject({ kind: "retorno", dealId: null, contactId: rita, assigneeId: ana, title: "Chamar Rita para voltar (prevista 02/11)" });
});

it("Lembrar com conversa aberta: a tarefa fica na conversa; data que já passou é recusada", async () => {
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [d] = await db.insert(deals).values({ contactId: rita, stageId: lead.id }).returning();
  const r = await remindReturn(rita, { dueOn: null }, ana, NOW);
  expect(r.dueAt.toISOString()).toBe("2026-10-16T13:00:00.000Z"); // sem previsão: amanhã 10h
  expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId)))[0].dealId).toBe(d.id);
  await expect(remindReturn(rita, { dueAt: new Date("2026-10-01T13:00:00Z") }, ana, NOW)).rejects.toThrow("Essa data já passou");
});

it("CPF: confere os dígitos, guarda só os números, vazio apaga e a auditoria não leva o número", async () => {
  await expect(updateContactProfile(rita, { cpf: "529.982.247-24" }, ana)).rejects.toThrow("CPF inválido");
  expect((await contato()).cpf).toBeNull();
  expect(await updateContactProfile(rita, { cpf: "529.982.247-25" }, ana)).toEqual({ changed: ["cpf"] });
  expect((await contato()).cpf).toBe("52998224725");
  const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, rita));
  expect(JSON.stringify(logs.map((l) => l.data))).not.toContain("529");
  expect(logs.at(-1)?.data).toEqual({ campos: ["CPF"] });
  await updateContactProfile(rita, { cpf: "" }, ana);
  expect((await contato()).cpf).toBeNull();
});

it("Dados da cliente (16/10): apelido, outro telefone, Instagram, tipo de cabelo e WhatsApp, com as conferências", async () => {
  expect(await updateContactProfile(rita, { nickname: " Bia ", phoneAlt: "(71) 3333-0000", instagram: "@rita.ficticia", hairType: "cacheado 3B" }, ana))
    .toEqual({ changed: ["nickname", "hairType", "instagram", "phoneAlt"] });
  expect(await contato()).toMatchObject({ nickname: "Bia", instagram: "rita.ficticia", hairType: "cacheado 3B" });
  expect((await contato()).phoneAlt).toMatch(/3333/);
  await expect(updateContactProfile(rita, { instagram: "não é @ válido!" }, ana)).rejects.toThrow("Instagram inválido");
  await expect(updateContactProfile(rita, { phone: "123" }, ana)).rejects.toThrow("WhatsApp inválido");
  await db.insert(contacts).values({ name: "Outra Fictícia", phoneE164: "+5571966000102" });
  await expect(updateContactProfile(rita, { phone: "(71) 96600-0102" }, ana)).rejects.toThrow("já é de outra cliente");
  await updateContactProfile(rita, { phone: "(71) 96600-0199" }, ana);
  expect((await contato()).phoneE164).toBe("+5571966000199");
});

it("pessoa a mais no número da filha ganha o WhatsApp dela: vira cliente com número próprio (20/10)", async () => {
  const mae = (await db.insert(contacts).values({ name: "Mãe Fictícia", phoneE164: `pessoa:${crypto.randomUUID()}`, sharesPhoneWith: rita, phoneRelation: "mãe" }).returning())[0].id;
  await db.insert(contacts).values({ name: "Outra Fictícia", phoneE164: "+5571966000102" });
  await expect(updateContactProfile(mae, { phone: "(71) 96600-0102" }, ana)).rejects.toThrow("já é de outra cliente");
  expect((await updateContactProfile(mae, { phone: "(71) 96600-0555" }, ana)).changed).toEqual(["phone"]);
  const [m] = await db.select().from(contacts).where(eq(contacts.id, mae));
  expect(m).toMatchObject({ phoneE164: "+5571966000555", sharesPhoneWith: null, phoneRelation: null });
});

/* ───────── 0081: uso de imagem ───────── */
const gestora = permsFor("gestor");

it("Uso de imagem 'sim' sem data grava hoje; 'nao' apaga a data", async () => {
  const hoje = "2026-10-15";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  try {
    expect((await updateContactProfile(rita, { imageUse: "sim" }, ana, gestora)).changed).toEqual(["imageUse"]);
    expect(await contato()).toMatchObject({ imageUse: "sim", imageUseOn: hoje });
    await updateContactProfile(rita, { imageUseOn: "2026-03-12" }, ana, gestora);
    expect(await contato()).toMatchObject({ imageUse: "sim", imageUseOn: "2026-03-12" });
    await updateContactProfile(rita, { imageUse: "nao" }, ana, gestora);
    expect(await contato()).toMatchObject({ imageUse: "nao", imageUseOn: null });
    await updateContactProfile(rita, { imageUse: null }, ana, gestora);
    expect(await contato()).toMatchObject({ imageUse: null, imageUseOn: null });
  } finally { vi.useRealTimers(); }
});
it("uso de imagem: data inválida ou sem 'sim' é recusada; valor fora de sim/nao também", async () => {
  await expect(updateContactProfile(rita, { imageUse: "sim", imageUseOn: "12/03/2026" }, ana, gestora)).rejects.toBeInstanceOf(UserFacingError);
  await expect(updateContactProfile(rita, { imageUseOn: "2026-03-12" }, ana, gestora)).rejects.toThrow("A data só vale para quem autorizou.");
  await expect(updateContactProfile(rita, { imageUse: "talvez" as never }, ana, gestora)).rejects.toBeInstanceOf(UserFacingError);
  expect(await contato()).toMatchObject({ imageUse: null, imageUseOn: null });
});
it("sem contatos.uso_imagem recusa mudar o uso de imagem; o resto do Editar dados segue", async () => {
  const sem = gestora.filter((p) => p !== "contatos.uso_imagem");
  await expect(updateContactProfile(rita, { imageUse: "sim" }, ana, sem)).rejects.toThrow("Você não tem permissão para isso.");
  await expect(updateContactProfile(rita, { imageUse: "sim" }, ana)).rejects.toThrow("Você não tem permissão para isso.");
  // Mandar o valor que já está não é mudar.
  expect((await updateContactProfile(rita, { name: "Rita Nova", imageUse: null, imageUseOn: null }, ana, sem)).changed).toEqual(["name"]);
  expect(await contato()).toMatchObject({ name: "Rita Nova", imageUse: null });
});
it("função uso_imagem desligada recusa gravar o uso de imagem", async () => {
  await saveFuncoes({ uso_imagem: false }, ana);
  await expect(updateContactProfile(rita, { imageUse: "nao" }, ana, gestora)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
  expect((await updateContactProfile(rita, { name: "Rita Y" }, ana, gestora)).changed).toEqual(["name"]);
});
it("uso de imagem: ano antes de 2000 (digitar o ano aos poucos) e data depois de hoje são recusados", async () => {
  await expect(updateContactProfile(rita, { imageUse: "sim", imageUseOn: "0002-03-12" }, ana, gestora)).rejects.toThrow("Data inválida: use de 2000 em diante.");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  try {
    await expect(updateContactProfile(rita, { imageUse: "sim", imageUseOn: "2026-10-16" }, ana, gestora)).rejects.toThrow("A data não pode ser depois de hoje.");
    await updateContactProfile(rita, { imageUse: "sim", imageUseOn: "2026-10-15" }, ana, gestora);
    expect(await contato()).toMatchObject({ imageUse: "sim", imageUseOn: "2026-10-15" });
  } finally { vi.useRealTimers(); }
});

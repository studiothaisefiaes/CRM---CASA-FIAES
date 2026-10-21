import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { addNote } from "./notes";
import { exportConversationText } from "./conversation-export";

let sara = "", gestao = "", dealId = "", contactId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestao }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999990091", pushName: "Cliente Teste", body: "Oi, quanto custa a escova?", at: new Date("2026-10-15T17:02:00Z") });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nA escova sai por R$ 80.", userId: sara, at: new Date("2026-10-15T17:05:00Z") });
  await addNote({ dealId, body: "Cliente prefere sábado" }, sara, new Date("2026-10-15T17:06:00Z"));
});

describe("exportar conversa", () => {
  it("texto com cliente e Casa, sem notas por padrão, e registra quem exportou", async () => {
    const out = await exportConversationText(contactId, { id: gestao, name: "Thaíse Teste" }, { notes: false }, new Date("2026-10-15T18:00:00Z"));
    expect(out!.filename).toBe("conversa-cliente-teste-2026-10-15.txt");
    expect(out!.body).toContain("Cliente Teste (cliente): Oi, quanto custa a escova?");
    expect(out!.body).toContain("Casa Fiaes (Sara Lima): A escova sai por R$ 80.");
    expect(out!.body).not.toContain("Cliente prefere sábado");
    const withNotes = await exportConversationText(contactId, { id: gestao, name: "Thaíse Teste" }, { notes: true });
    expect(withNotes!.body).toContain("Nota interna de Sara Lima: Cliente prefere sábado");
    const logs = await db.select().from(auditLog).where(eq(auditLog.entity, "conversa"));
    expect(logs.map((l) => [l.userId, l.action, (l.data as { notas: boolean }).notas])).toEqual([[gestao, "exportou", false], [gestao, "exportou", true]]);
  });
  it("contato que não existe: nada", async () => {
    expect(await exportConversationText("00000000-0000-4000-8000-000000000000", { id: gestao, name: "x" }, { notes: false })).toBeNull();
  });
  it("a anotação da ligação entra com o assunto", async () => {
    const c = await recordInbound({ channelId: null, externalId: "call:9", phoneRaw: "71999990091", kind: "call", body: "Ligação recebida · atendida", noWait: true, at: new Date("2026-10-15T17:10:00Z") });
    if (!("messageId" in c)) throw new Error("sem ligação");
    await addNote({ dealId, body: "marcou corte sábado", subject: "Agendamento", messageId: c.messageId }, sara, new Date("2026-10-15T17:12:00Z"));
    const out = await exportConversationText(contactId, { id: gestao, name: "Thaíse Teste" }, { notes: true });
    expect(out!.body).toContain("Cliente Teste (cliente): Ligação recebida · atendida");
    expect(out!.body).toContain("Nota interna de Sara Lima: Agendamento — marcou corte sábado");
  });
});

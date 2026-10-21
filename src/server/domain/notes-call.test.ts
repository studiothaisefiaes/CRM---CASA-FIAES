import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, contactNotes, deals, messages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { addNote, notesOf } from "./notes";

let sara = "", dealId = "", contactId = "", callId = "", textId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "N1", phoneRaw: "71999990002", pushName: "Cliente Teste Dois", body: "Oi" });
  if (!("messageId" in r)) throw new Error("sem lead");
  dealId = r.dealId; textId = r.messageId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  const c = await recordInbound({ channelId: null, externalId: "call:1", phoneRaw: "71999990002", kind: "call", body: "Ligação recebida · atendida · 3 min", noWait: true });
  if (!("messageId" in c)) throw new Error("sem ligação");
  callId = c.messageId;
  await db.update(messages).set({ call: { video: false, status: "atendida", durationSecs: 185 } }).where(eq(messages.id, callId));
  await db.insert(alerts).values({ dealId, audience: "gestao", type: "ligacao_sem_nota", severity: "info", message: "Anote a ligação", dedupeKey: `ligacao:${callId}` });
});

describe("anotar o que foi falado na ligação", () => {
  it("grava assunto + o que ocorreu ligado à ligação, com autora e hora; aparece nas notas da cliente", async () => {
    await addNote({ dealId, body: "marcou corte sábado 14h com a Ana", subject: "Agendamento", messageId: callId }, sara);
    const [n] = await notesOf(contactId);
    expect(n).toMatchObject({ body: "marcou corte sábado 14h com a Ana", subject: "Agendamento", messageId: callId, authorName: "Sara Lima" });
  });

  it("anotar some com o lembrete da ligação", async () => {
    await addNote({ dealId, body: "tirou dúvida de preço", messageId: callId }, sara);
    const [a] = await db.select().from(alerts).where(eq(alerts.dedupeKey, `ligacao:${callId}`));
    expect(a.resolvedAt).not.toBeNull();
  });

  it("recusa ligar a nota a algo que não é ligação desta cliente", async () => {
    await expect(addNote({ dealId, body: "x", messageId: textId }, sara)).rejects.toThrow("ligação");
    await expect(addNote({ dealId, body: "x", messageId: "00000000-0000-4000-8000-000000000000" }, sara)).rejects.toThrow("ligação");
    expect(await db.select().from(contactNotes)).toHaveLength(0);
  });

  it("assunto longo demais é recusado", async () => {
    await expect(addNote({ dealId, body: "x", subject: "a".repeat(121), messageId: callId }, sara)).rejects.toThrow("Assunto");
  });
});

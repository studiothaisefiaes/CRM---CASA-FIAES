import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { contactNotes, contacts, deals, messages, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getQueueItem } from "./queue";

beforeEach(async () => { await resetDb(); });

describe("prévia da Fila com ligação (Lote 5)", () => {
  it("'Ligação 3 min · marcou corte sábado': a duração e a anotação da ligação", async () => {
    const [lead] = (await db.select().from(stages)).filter((s) => s.key === "lead");
    const [c] = await db.insert(contacts).values({ name: "Cliente Teste Um", phoneE164: "+5571999990071" }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: lead.id }).returning();
    const [m] = await db.insert(messages).values({ dealId: d.id, contactId: c.id, direction: "in", kind: "call", body: "Ligação recebida · atendida · 3 min",
      call: { video: false, status: "atendida", durationSecs: 185 } }).returning();
    expect((await getQueueItem(d.id))?.lastMessage).toBe("Ligação 3 min");
    await db.insert(contactNotes).values({ contactId: c.id, dealId: d.id, body: "marcou corte sábado 14h com a Ana", subject: "marcou corte sábado", messageId: m.id });
    expect((await getQueueItem(d.id))?.lastMessage).toBe("Ligação 3 min · marcou corte sábado");
  });
});

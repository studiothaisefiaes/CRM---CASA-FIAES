import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, lists, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyStaleConversations, planStaleConversations } from "./organizar-parados";
import { NO_REPLY_REASON } from "./funnel";

const NOW = new Date("2026-10-24T10:30:00Z"); // sábado 7h30 em Salvador
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
let n = 0;

async function conversa(o: { casaHaDias: number; clienteHaDias?: number; kind?: string; stage?: string; futureTask?: boolean; futureVisit?: boolean }) {
  const [c] = await db.insert(contacts).values({ name: `Cliente ${++n}`, phoneE164: `+5571988${String(n).padStart(6, "0")}`, kind: (o.kind ?? "cliente") as never }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, o.stage ?? "atendimento"));
  const [d] = await db.insert(deals).values({
    contactId: c.id, stageId: st.id, stageEnteredAt: daysAgo(30), createdAt: daysAgo(30),
    lastOutboundAt: daysAgo(o.casaHaDias), lastInboundAt: o.clienteHaDias == null ? null : daysAgo(o.clienteHaDias),
  }).returning();
  if (o.futureTask) await db.insert(tasks).values({ dealId: d.id, contactId: c.id, title: "Ligar", kind: "proxima_acao", dueAt: new Date(NOW.getTime() + 86_400_000) });
  if (o.futureVisit) await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", status: "agendado", origin: "crm", externalKey: `t:${n}`, startsAt: new Date(NOW.getTime() + 3 * 86_400_000), durationMin: 60 });
  return d.id;
}

beforeEach(async () => { await resetDb(); n = 0; });

describe("organizar os parados (dono 24/10: 'organize conversas sim')", () => {
  it("Em conversa, a Casa falou por último há mais de 7 dias, sem horário nem combinado para a frente: entra; o resto fica", async () => {
    const parada = await conversa({ casaHaDias: 9, clienteHaDias: 10 });
    const semResposta = await conversa({ casaHaDias: 12 });
    await conversa({ casaHaDias: 5, clienteHaDias: 6 }); // recente
    await conversa({ casaHaDias: 10, clienteHaDias: 8 }); // a cliente falou por último: precisa de resposta
    await conversa({ casaHaDias: 10, futureTask: true }); // alguém combinou retomar
    await conversa({ casaHaDias: 10, futureVisit: true }); // tem horário marcado
    await conversa({ casaHaDias: 10, kind: "fornecedor" });
    await conversa({ casaHaDias: 10, stage: "orcamento" }); // outra etapa
    expect((await planStaleConversations(NOW)).sort()).toEqual([parada, semResposta].sort());
  });

  it("aplicar: vai para Perdido 'Não respondeu mais' com o recontato marcado, como no fim das 3 tentativas", async () => {
    const id = await conversa({ casaHaDias: 9, clienteHaDias: 10 });
    expect(await applyStaleConversations([id], NOW)).toEqual({ moved: 1, errors: [] });
    const [d] = await db.select({ key: stages.key, reason: lists.label, recontact: deals.recontactAt }).from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(lists, eq(lists.id, deals.lostReasonId)).where(eq(deals.id, id));
    expect(d.key).toBe("perdido");
    expect(d.reason).toBe(NO_REPLY_REASON);
    expect(d.recontact).not.toBeNull();
    expect(await planStaleConversations(NOW)).toEqual([]);
  });
});

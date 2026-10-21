import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, messages, users } from "../db/schema";
import { getDealDetail } from "../queries/deal";
import { resetDb } from "../../../test/db";
import { ingestEvolution } from "../whatsapp/webhook";
import { lidLookup } from "../whatsapp/lid-pairs";
import { startConversation } from "./start-conversation";

/**
 * Caso real de 17/10 (MANOELA): a Cati mandou mensagem pelo ChatGuru às 09:25; o eco chegou só com o @lid (sem número) e virou
 * um contato "Número oculto" com conversa própria. Às 09:26 ela abriu a ficha da cliente e tocou "Iniciar conversa": como a cliente
 * (pelo número) não tinha conversa aberta, nasceu uma segunda conversa, vazia ("Nenhuma mensagem ainda").
 */
const PHONE = "+5571999990101";
const LID = "267300000000001";
const echoLidOnly = (id: string, text: string, ts: number) => ({
  event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: `${LID}@lid`, fromMe: true, id, participant: "", addressingMode: "lid" }, pushName: "Casa Fiaes",
    message: { conversation: text }, messageType: "conversation", messageTimestamp: ts },
});
const inboundWithLid = (id: string, text: string, ts: number) => ({
  event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: `${LID}@lid`, remoteJidAlt: "5571999990101@s.whatsapp.net", fromMe: false, id, addressingMode: "lid" }, pushName: "Manu",
    message: { conversation: text }, messageType: "conversation", messageTimestamp: ts },
});
const now = () => Math.floor(Date.now() / 1000);
const openDeals = () => db.select().from(deals).where(and(isNull(deals.closedAt), isNull(deals.archivedAt)));

let cati = "";
let clientId = "";
beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
  cati = (await db.insert(users).values({ name: "Cati", email: "cati@c.com", role: "atendente", passwordHash: "x", signature: "CATI" }).returning())[0].id;
  clientId = (await db.insert(contacts).values({ name: "MANOELA FICTÍCIA", phoneE164: PHONE, isClient: true }).returning())[0].id;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("mensagem da Casa por outro aparelho que chega só com o @lid", () => {
  it("a Evolution já sabe o número do @lid: a mensagem entra na conversa da cliente, sem contato oculto", async () => {
    vi.spyOn(lidLookup, "phoneForLid").mockResolvedValue(PHONE);
    await ingestEvolution(echoLidOnly("E1", "*CATI - CASA FIAES:*\nOlá! Passando para lembrar", now() - 60));
    expect((await db.select().from(contacts)).map((c) => c.phoneE164)).toEqual([PHONE]);
    const [c] = await db.select().from(contacts);
    expect(c.waLid).toBe(LID);
    const open = await openDeals();
    expect(open).toHaveLength(1);
    expect(open[0].contactId).toBe(clientId);
    expect((await db.select().from(messages)).map((m) => m.dealId)).toEqual([open[0].id]);
  });

  it("número oculto que nunca escreveu NÃO vira conversa: a mensagem fica guardada, fora da Fila (20/10)", async () => {
    vi.spyOn(lidLookup, "phoneForLid").mockResolvedValue(null);
    vi.spyOn(lidLookup, "lidForPhone").mockResolvedValue(null);
    await ingestEvolution(echoLidOnly("E1", "Olá Bia! Passando para saber", now() - 600));
    await ingestEvolution(echoLidOnly("E2", "Olá! Passando para lembrar", now() - 300));
    expect(await openDeals()).toHaveLength(0);
    expect((await db.select().from(messages)).map((m) => m.body)).toEqual(["Olá Bia! Passando para saber", "Olá! Passando para lembrar"]);
    expect(await db.select().from(deals)).toHaveLength(1); // uma conversa arquivada só, não uma por mensagem
  });

  it("número desconhecido: a cliente escreve com o @lid e o número juntos e as conversas se juntam na hora (sem esperar o worker)", async () => {
    vi.spyOn(lidLookup, "phoneForLid").mockResolvedValue(null);
    vi.spyOn(lidLookup, "lidForPhone").mockResolvedValue(null);
    await ingestEvolution(echoLidOnly("E1", "Olá! Passando para lembrar", now() - 600));
    expect(await db.select().from(contacts)).toHaveLength(2); // ainda não dá para saber de quem é
    await ingestEvolution(inboundWithLid("I1", "Chegando", now() - 60));
    const cs = await db.select().from(contacts);
    expect(cs.map((c) => c.phoneE164)).toEqual([PHONE]);
    const open = await openDeals();
    expect(open).toHaveLength(1);
    expect((await db.select().from(messages)).every((m) => m.dealId === open[0].id && m.contactId === clientId)).toBe(true);
  });
});

describe("Iniciar conversa com a cliente que acabou de receber mensagem por outro aparelho", () => {
  it("a Evolution sabe o @lid do número: leva à conversa que já tem a mensagem, sem abrir outra", async () => {
    vi.spyOn(lidLookup, "phoneForLid").mockResolvedValue(null);
    await ingestEvolution(echoLidOnly("E1", "Olá! Passando para lembrar", now() - 60));
    vi.spyOn(lidLookup, "lidForPhone").mockResolvedValue(LID);
    const r = await startConversation(clientId, cati);
    expect(r.created).toBe(false);
    const open = await openDeals();
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(r.dealId);
    const detail = await getDealDetail(r.dealId);
    expect(detail!.contact.id).toBe(clientId);
    expect(detail!.messages.map((m) => m.body)).toEqual(["Olá! Passando para lembrar"]);
  });

});

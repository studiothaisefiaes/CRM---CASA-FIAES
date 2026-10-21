import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { contacts, deals, visits } from "./db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../../test/db";
import { setupAgenda } from "../../test/agenda-fixtures";
import { addNote } from "./domain/notes";
import { recordInbound } from "./domain/deals";
import { saveQuestion, saveAnswer } from "./domain/fichas";
import { addClientPhoto } from "./domain/client-photos";
import { exportContactRows, contactsCsv } from "./queries/contacts-csv";
import { exportConversationText } from "./domain/conversation-export";
import { loadClienteContext } from "./ai/cliente";
import { clientContext } from "./queries/client-context";

/**
 * Trava de privacidade (Fase C, 21 e 25b): CPF, respostas das fichas e fotos da cliente ficam fora do CSV de Clientes, do Exportar conversa,
 * do contexto da IA. Vale sempre nesta fase, inclusive com consentimento (o consentimento é da Fase B).
 */
const SEGREDO = "SEGREDO-FICHA-7";
const CPF = "529.982.247-25"; // válido, inventado
const CPF_DIGITS = "52998224725";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const NOW = new Date("2026-10-15T12:00:00Z");

let contactId: string, dealId: string, u: string, photoId: string;
beforeEach(async () => {
  await resetDb();
  const s = await setupAgenda();
  u = s.gestora.id;
  const r = await recordInbound({ channelId: null, externalId: "PV1", phoneRaw: "71999990777", pushName: "Rita Fictícia", body: "Oi, quero marcar", at: new Date("2026-10-15T11:00:00Z"), now: NOW });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  await db.update(contacts).set({ cpf: CPF_DIGITS }).where(eq(contacts.id, contactId));
  await addNote({ dealId, body: "Cliente prefere sábado" }, u, new Date("2026-10-15T11:30:00Z"));
  const visit = (await db.insert(visits).values({ contactId, day: "2026-10-14" }).returning())[0].id;
  const ana = (await saveQuestion({ form: "anamnese", label: "Alergias?", kind: "texto" }, u)).id;
  const con = (await saveQuestion({ form: "consultoria", label: "Estilo", kind: "texto_longo" }, u)).id;
  const cam = (await saveQuestion({ form: "campos", label: "Apelido", kind: "texto" }, u)).id;
  await saveAnswer({ contactId, questionId: ana, value: SEGREDO }, u);
  await saveAnswer({ contactId, questionId: con, visitId: visit, value: SEGREDO }, u);
  await saveAnswer({ contactId, questionId: cam, value: SEGREDO }, u);
  photoId = (await addClientPhoto({ contactId, visitId: visit, kind: "antes", data: JPEG }, u)).id;
});

const proibido = (texto: string) => {
  expect(texto).not.toContain(SEGREDO);
  expect(texto).not.toContain(CPF);
  expect(texto).not.toContain(CPF_DIGITS);
  expect(texto).not.toContain("galeria/");
  expect(texto).not.toContain(photoId);
  expect(texto).not.toContain("/fotos/");
};

describe("dado de cliente fora de exportação e da IA", () => {
  it("o CPF e as respostas existem no banco (a trava testa algo de verdade)", async () => {
    expect((await db.select().from(contacts).where(eq(contacts.id, contactId)))[0].cpf).toBe(CPF_DIGITS);
  });
  it("CSV de Clientes não traz resposta, CPF nem foto", async () => {
    const csv = contactsCsv(await exportContactRows({}, true), { money: true });
    expect(csv).toContain("Rita Fictícia"); // a cliente está lá; só os dados protegidos não
    proibido(csv);
  });
  it("Exportar conversa (com notas internas) não traz", async () => {
    const out = await exportConversationText(contactId, { id: u, name: "Thaíse" }, { notes: true }, NOW);
    expect(out!.body).toContain("Cliente prefere sábado");
    proibido(out!.body);
  });
  it("contexto da IA não traz", async () => {
    proibido(JSON.stringify(await loadClienteContext(contactId, NOW)));
    proibido(JSON.stringify(await clientContext(contactId, dealId, { money: true })));
  });
});

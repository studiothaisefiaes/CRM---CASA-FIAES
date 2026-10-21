import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { fiscalDocuments, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { resetDb } from "../../../../../test/db";
import { comanda } from "../../../../../test/financeiro-fixtures";
import { GET } from "./route";

const CHAVE = "29274082112223330001810000000000000000000000000042";
let cookie: string, docId: string, profileId: string;
const get = (id: string, q = "") => GET(new NextRequest(`http://localhost/api/notas-fiscais/${id}${q}`, { headers: { cookie } }), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  const [p] = await db.insert(profiles).values({ name: "Teste nota", permissions: ["nota.ver"] }).returning();
  profileId = p.id;
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: p.id }).returning();
  cookie = `cf_session=${(await insertSession(u.id)).token}`;
  const c = await comanda({ day: "2026-10-15", by: u.id, items: [{ label: "Corte", unitCents: 12000, netCents: 12000 }] });
  const [d] = await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: "nfse", environment: "teste", series: 1, number: 7, localId: "DPS1", status: "autorizada", amountCents: 12000,
    accessKey: CHAVE, requestXml: '<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS1"/></DPS>',
    responseBody: '<?xml version="1.0" encoding="utf-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe/></NFSe>' }).returning();
  docId = d.id;
});

it("sem sessão 401; sem nota.ver 403 (caixa.operar não basta)", async () => {
  const anon = await GET(new NextRequest(`http://localhost/api/notas-fiscais/${docId}?formato=xml`), { params: Promise.resolve({ id: docId }) });
  expect(anon.status).toBe(401);
  await db.update(profiles).set({ permissions: ["caixa.operar", "caixa.gerir"] }).where(eq(profiles.id, profileId));
  expect((await get(docId, "?formato=xml")).status).toBe(403);
});

it("?formato=xml devolve a DPS assinada e a resposta do governo, para baixar", async () => {
  const r = await get(docId, "?formato=xml");
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/xml; charset=utf-8");
  expect(r.headers.get("content-disposition")).toBe('attachment; filename="nfse-7.xml"');
  const body = await r.text();
  expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><notaFiscal numero="7" situacao="autorizada" chave="29274082112223330001810000000000000000000000000042">/);
  expect(body).toContain('<dps><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS1"/></DPS></dps>');
  expect(body).toContain('<resposta><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe/></NFSe></resposta>');
});

it("resposta em JSON (rejeitada) vai em CDATA", async () => {
  await db.update(fiscalDocuments).set({ status: "rejeitada", accessKey: null, responseBody: '{"erros":[{"Codigo":"E1","Descricao":"a ]]> b"}]}' }).where(eq(fiscalDocuments.id, docId));
  const body = await (await get(docId, "?formato=xml")).text();
  expect(body).toContain('<resposta><![CDATA[{"erros":[{"Codigo":"E1","Descricao":"a ]]]]><![CDATA[> b"}]}]]></resposta>');
});

it("?formato=pdf: 501 com a chave para abrir no nfse.gov.br (o DANFSe do ADN foi suspenso)", async () => {
  const r = await get(docId, "?formato=pdf");
  expect(r.status).toBe(501);
  expect(await r.text()).toBe(`Abra a nota no nfse.gov.br com a chave ${CHAVE}.`);
});

it("nota que não existe ou id inválido: 404; formato desconhecido: 400", async () => {
  expect((await get("11111111-1111-4111-8111-111111111111", "?formato=xml")).status).toBe(404);
  expect((await get("abc", "?formato=xml")).status).toBe(404);
  expect((await get(docId, "?formato=doc")).status).toBe(400);
});

it("NFC-e (Task 13): o XML é o nfeProc autorizado, como nfce-{n}.xml; o PDF manda consultar pela SEFAZ-BA", async () => {
  const [c] = await db.select({ comandaId: fiscalDocuments.comandaId }).from(fiscalDocuments).where(eq(fiscalDocuments.id, docId));
  const chave = "29261011222333000181650010000000011123456786";
  const proc = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}"/></NFe><protNFe/></nfeProc>`;
  const [d] = await db.insert(fiscalDocuments).values({ comandaId: c.comandaId, kind: "nfce", environment: "teste", series: 1, number: 3, localId: `NFe${chave}`, status: "autorizada", amountCents: 4590,
    accessKey: chave, requestXml: `<NFe><infNFe Id="NFe${chave}"/></NFe>`, responseBody: proc }).returning();
  const r = await get(d.id, "?formato=xml");
  expect(r.headers.get("content-disposition")).toBe('attachment; filename="nfce-3.xml"');
  expect(await r.text()).toBe(`<?xml version="1.0" encoding="UTF-8"?>${proc}`);
  const pdf = await get(d.id, "?formato=pdf");
  expect(pdf.status).toBe(501);
  expect(await pdf.text()).toBe(`Consulte a NFC-e pelo QR Code ou no portal da SEFAZ-BA com a chave ${chave}.`);
  // Ainda sem nfeProc (pendente ou recusada): o pacote com o XML enviado.
  await db.update(fiscalDocuments).set({ status: "rejeitada", responseBody: "<retEnviNFe/>" }).where(eq(fiscalDocuments.id, d.id));
  const body = await (await get(d.id, "?formato=xml")).text();
  expect(body).toContain(`<notaFiscal numero="3" situacao="rejeitada"`);
  expect(body).toContain(`<nfe><NFe><infNFe Id="NFe${chave}"/></NFe></nfe><resposta><retEnviNFe/></resposta>`);
});

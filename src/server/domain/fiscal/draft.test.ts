import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { comandaItems, fiscalDocuments, lists, professionals, settings } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { DEFAULT_FISCAL_REGRAS } from "@/lib/fiscal-settings";
import { buildDiscriminacao, loadNfseDraft, loadNotaFiscalInfo } from "./draft";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const set = (key: string, value: unknown) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  await db.update(professionals).set({ bond: "parceira", cnpj: "11222333000181", legalName: "ANA SILVA ME" }).where(eq(professionals.id, s.ana.id));
  await db.update(professionals).set({ bond: "clt" }).where(eq(professionals.id, s.bia.id));
});

async function mista() {
  const c = await comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Paula", items: [
    { label: "Corte", unitCents: 10000, professionalId: s.ana.id, netCents: 8100, commissionCents: 3240 },
    { label: "Hidratação", unitCents: 5000, professionalId: s.bia.id, netCents: 4050 },
    { label: "Shampoo", kind: "produto", unitCents: 4000, netCents: 4000 },
    { label: "Sessão", kind: "pacote_sessao", unitCents: 0, netCents: 0 },
  ] });
  await db.update(comandaItems).set({ partnerCnpj: "11222333000181" }).where(eq(comandaItems.id, c.items[0].id));
  await db.update(comandaItems).set({ fiscalKind: "produto" }).where(eq(comandaItems.id, c.items[2].id));
  return c;
}

describe("rascunho da nota", () => {
  it("nota da comanda: só serviços, cotas separadas e texto fixo", async () => {
    const c = await mista();
    const d = (await loadNfseDraft(c.id))!;
    expect(d.lines.map((l) => l.label)).toEqual(["Corte", "Hidratação"]);
    expect([d.totalCents, d.salaoCents]).toEqual([12150, 8910]);
    expect(d.lines[0]).toMatchObject({ partner: { legalName: "ANA SILVA ME", cnpj: "11222333000181" }, cTribNac: "060101", professional: "Ana" });
    expect(d.discriminacao).toBe("Serviços de beleza: Corte, Hidratação. Salão-parceiro (Lei 13.352/2016): cota-parte do salão R$ 89,10; cota-parte de ANA SILVA ME (CNPJ 11.222.333/0001-81) R$ 32,40.");
  });
  it("valor redondo sai com ',00' (R$ 100,00), nunca 'R$ 100'", () => {
    const d: Parameters<typeof buildDiscriminacao>[0] = { comandaId: "x", comandaNumber: 1, day: "2026-10-15", tomador: { cpf: null, nome: null }, totalCents: 20000, salaoCents: 10000,
      lines: [{ itemId: "i", label: "Corte", netCents: 20000, professional: null, partner: null, cTribNac: "060101", nbs: null }], parceiras: [{ legalName: "X", cnpj: "11222333000181", cents: 10000 }] };
    const t = buildDiscriminacao(d);
    expect(t).toContain("R$ 100,00;");
    expect(t).toContain("R$ 100,00.");
    expect(t).not.toMatch(/[  ]/);
  });
  it("sem parceira, só a primeira frase; razão social vazia usa o nome completo e depois o nome", async () => {
    await db.update(professionals).set({ legalName: null, fullName: "Ana Maria Silva" }).where(eq(professionals.id, s.ana.id));
    const c = await mista();
    expect((await loadNfseDraft(c.id))!.parceiras[0].legalName).toBe("Ana Maria Silva");
    await db.update(professionals).set({ fullName: null }).where(eq(professionals.id, s.ana.id));
    expect((await loadNfseDraft(c.id))!.parceiras[0].legalName).toBe("Ana");
    const c2 = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Escova", unitCents: 3000, professionalId: s.bia.id, netCents: 3000 }] });
    expect((await loadNfseDraft(c2.id))!.discriminacao).toBe("Serviços de beleza: Escova.");
  });
  it("comanda só com produto ou só sessão de pacote: null", async () => {
    const p = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Shampoo", kind: "produto", unitCents: 4000, netCents: 4000 }] });
    await db.update(comandaItems).set({ fiscalKind: "produto" }).where(eq(comandaItems.comandaId, p.id));
    expect(await loadNfseDraft(p.id)).toBeNull();
    const q = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Sessão", kind: "pacote_sessao", unitCents: 0, netCents: 0 }] });
    expect(await loadNfseDraft(q.id)).toBeNull();
  });
  it("código do serviço: o do serviço, senão o padrão", async () => {
    const [svc] = await db.update(lists).set({ fiscalCtribNac: "060102" }).where(eq(lists.id, s.mechas.id)).returning();
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Mechas", unitCents: 3000, serviceId: svc.id, netCents: 3000 }, { label: "Outro", unitCents: 1000, netCents: 1000 }] });
    expect((await loadNfseDraft(c.id))!.lines.map((l) => l.cTribNac)).toEqual(["060102", "060101"]);
  });
  it("parceira sem CNPJ: a cota-parte dela não entra no texto e o rascunho avisa (sem aviso para quem tem CNPJ ou não é parceira)", async () => {
    await db.update(professionals).set({ bond: "parceira", cnpj: null, legalName: null }).where(eq(professionals.id, s.bia.id));
    const c = await mista(); // Hidratação é da Bia, parceira sem CNPJ: partner_cnpj ficou null no fechamento
    const d = (await loadNfseDraft(c.id))!;
    expect(d.parceiras.map((p) => p.cnpj)).toEqual(["11222333000181"]);
    expect(d.avisos).toEqual(["A parceira Bia está sem CNPJ: a cota-parte dela não entrou no texto. Cadastre o CNPJ em Configurações › Profissionais."]);
    expect(d.parceirasSemCnpj).toEqual(["Bia"]);
    await db.update(professionals).set({ bond: "clt" }).where(eq(professionals.id, s.bia.id));
    expect((await loadNfseDraft(c.id))!.avisos).toEqual([]);
  });
  it("o bloco da comanda leva o aviso da parceira sem CNPJ (chave desligada e ligada)", async () => {
    await db.update(professionals).set({ bond: "parceira", cnpj: null }).where(eq(professionals.id, s.bia.id));
    const c = await mista();
    const aviso = "A parceira Bia está sem CNPJ: a cota-parte dela não entrou no texto. Cadastre o CNPJ em Configurações › Profissionais.";
    expect((await loadNotaFiscalInfo(c.id)).avisos).toEqual([aviso]);
    await set("nfse_modo", "teste");
    expect((await loadNotaFiscalInfo(c.id)).avisos).toEqual([aviso]);
  });
  it("mudar o texto 'servicos' em Configurações muda a discriminação", async () => {
    const c = await mista();
    await set("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, textos: { ...DEFAULT_FISCAL_REGRAS.textos, servicos: "Prestação de serviços: {servicos}." } });
    expect((await loadNfseDraft(c.id))!.discriminacao).toMatch(/^Prestação de serviços: Corte, Hidratação\. Salão-parceiro/);
  });
});

describe("bloco da comanda", () => {
  it("chave desligada mostra os dados; desligar o rascunho em Configurações esconde", async () => {
    const c = await mista();
    const a = await loadNotaFiscalInfo(c.id);
    expect(a.modo).toBe("desligada");
    expect(a.dados).toMatchObject({ valor: "121,50", valorCents: 12150, codigoServico: "060101", cpf: null });
    await set("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, rascunhoNaComanda: false });
    expect((await loadNotaFiscalInfo(c.id)).dados).toBeNull();
  });
  it("chave desligada com nota já emitida (antes de desligar): a nota continua aparecendo", async () => {
    const c = await mista();
    expect((await loadNotaFiscalInfo(c.id)).documento).toBeNull();
    await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: "nfse", environment: "teste", series: 1, number: 9, localId: "DPS9", status: "autorizada", amountCents: 12150, accessKey: "1".repeat(50) });
    expect((await loadNotaFiscalInfo(c.id)).documento).toMatchObject({ status: "autorizada", number: 9, accessKey: "1".repeat(50) });
  });
  it("chave em teste: sem dados para copiar e com a situação da nota", async () => {
    const c = await mista();
    await set("nfse_modo", "teste");
    expect(await loadNotaFiscalInfo(c.id)).toEqual({ modo: "teste", dados: null, documento: null });
    await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: "nfse", environment: "teste", series: 1, number: 7, localId: "DPS7", status: "autorizada", amountCents: 12150 });
    expect((await loadNotaFiscalInfo(c.id)).documento).toMatchObject({ status: "autorizada", number: 7, environment: "teste" });
  });
  it("Nota de produto (NFC-e): aparece com a chave ligada ou com nota emitida; QR Code e prazo de cancelamento vêm da nota e de Configurações", async () => {
    const c = await mista();
    expect((await loadNotaFiscalInfo(c.id)).nfce).toBeUndefined(); // NFC-e desligada e nenhuma emitida
    await set("nfce_modo", "teste");
    expect((await loadNotaFiscalInfo(c.id)).nfce).toEqual({ modo: "teste", documento: null });
    const soServico = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Corte", unitCents: 12000, netCents: 12000 }] });
    expect((await loadNotaFiscalInfo(soServico.id)).nfce).toEqual({ modo: "teste", documento: null, semProduto: true });
    const chave = "29261011222333000181650010000000011123456786";
    const qr = `http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=${chave}|2|2|1|ABC`;
    await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: "nfce", environment: "teste", series: 1, number: 1, localId: `NFe${chave}`, status: "autorizada", amountCents: 4000, accessKey: chave,
      requestXml: `<NFe><infNFe Id="NFe${chave}"/><infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode></infNFeSupl></NFe>`, authorizedAt: new Date("2026-10-15T18:00:00Z") });
    await set("nfce_modo", "desligada");
    await set("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, nfceCancelarAteMin: 20 });
    const info = await loadNotaFiscalInfo(c.id);
    expect(info.nfce).toEqual({ modo: "desligada", documento: { id: expect.any(String), environment: "teste", status: "autorizada", number: 1, amountCents: 4000, rejectReason: null, accessKey: chave, consultaUrl: qr, cancelarAte: "2026-10-15T18:20:00.000Z", attempts: 0 } });
    expect(info.documento).toBeNull(); // a NFS-e continua separada
  });
});

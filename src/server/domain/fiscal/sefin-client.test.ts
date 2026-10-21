import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeTestPfx, TEST_PFX_PASSWORD } from "../../../../test/fiscal-cert";
import { readPfx } from "./certificate";
import { createSefinClient, httpsTransport, SEFIN_URL, type SefinTransport } from "./sefin-client";

type Req = Parameters<SefinTransport>[0];
const CHAVE = "29" + "0".repeat(46) + "42"; // 50 números
const DPS_ID = "DPS292740821122233300018100001000000000000042";
const gz = (s: string) => gzipSync(Buffer.from(s, "utf8")).toString("base64");

/** Transporte de mentira: grava as chamadas e responde na ordem dada (função = lança, para simular rede caída). */
function stub(...answers: ({ status: number; json: unknown } | (() => never))[]) {
  const calls: Req[] = [];
  const transport: SefinTransport = async (r) => {
    calls.push(r);
    const a = answers.shift();
    if (!a) throw new Error("sem resposta no stub");
    if (typeof a === "function") return a();
    return a;
  };
  return { calls, transport };
}

describe("endereços", () => {
  it("Produção Restrita no teste, Sefin Nacional na produção", () => {
    expect(SEFIN_URL).toEqual({ teste: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional", producao: "https://sefin.nfse.gov.br/SefinNacional" });
  });
});

describe("emitir", () => {
  it("201 → autorizada com a chave e o XML da NFS-e descompactado", async () => {
    const { calls, transport } = stub({ status: 201, json: { tipoAmbiente: 2, idDps: DPS_ID, chaveAcesso: CHAVE, nfseXmlGZipB64: gz("<NFSe>ok</NFSe>") } });
    const r = await createSefinClient({ environment: "teste", transport }).emitir("<DPS>assinada</DPS>");
    expect(r).toMatchObject({ kind: "autorizada", accessKey: CHAVE, nfseXml: "<NFSe>ok</NFSe>" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse" });
  });
  it("200 também vale como sucesso; capitalização das chaves não importa", async () => {
    const { transport } = stub({ status: 200, json: { ChaveAcesso: CHAVE, NfseXmlGZipB64: gz("<NFSe/>") } });
    expect(await createSefinClient({ environment: "producao", transport }).emitir("<DPS/>")).toMatchObject({ kind: "autorizada", accessKey: CHAVE, nfseXml: "<NFSe/>" });
  });
  it("o corpo do POST é o XML gzip+base64 (descompactado = o XML assinado)", async () => {
    const { calls, transport } = stub({ status: 201, json: { chaveAcesso: CHAVE } });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS><infDPS>Serviços de beleza: ação</infDPS></DPS>`;
    await createSefinClient({ environment: "producao", transport }).emitir(xml);
    expect(calls[0].url).toBe("https://sefin.nfse.gov.br/SefinNacional/nfse");
    const body = calls[0].body as Record<string, string>;
    expect(Object.keys(body)).toEqual(["dpsXmlGZipB64"]);
    expect(gunzipSync(Buffer.from(body.dpsXmlGZipB64, "base64")).toString("utf8")).toBe(xml);
  });
  it("400 com erros → rejeitada com as descrições (aceita erros/Erros/erro, Codigo/codigo, Descricao/descricao)", async () => {
    const c = (json: unknown) => createSefinClient({ environment: "teste", transport: stub({ status: 400, json }).transport }).emitir("<DPS/>");
    expect(await c({ idDPS: DPS_ID, erros: [{ Codigo: "E999", Descricao: "Erro não catalogado" }, { Codigo: "E0714", Descricao: "Assinatura inválida", Complemento: "digest" }] }))
      .toMatchObject({ kind: "rejeitada", reasons: ["Erro não catalogado (E999)", "Assinatura inválida: digest (E0714)"] });
    expect(await c({ Erros: [{ codigo: "E1", descricao: "Um" }] })).toMatchObject({ kind: "rejeitada", reasons: ["Um (E1)"] });
    expect(await c({ erro: { Codigo: "E2", Descricao: "Dois" } })).toMatchObject({ kind: "rejeitada", reasons: ["Dois (E2)"] });
    expect(await c(null)).toMatchObject({ kind: "rejeitada", reasons: ["O governo recusou o envio (HTTP 400)."] });
  });
  it("DPS já recebida (duplicada / já existe) não é recusa: falha, para a consulta resolver (código NÃO CONFIRMADO, vale o texto)", async () => {
    const c = (json: unknown) => createSefinClient({ environment: "teste", transport: stub({ status: 400, json }).transport }).emitir("<DPS/>");
    for (const descricao of ["DPS já existe para este identificador", "Identificador de DPS duplicado", "Já foi gerada uma NFS-e para esta DPS", "Duplicidade de DPS"]) {
      const r = await c({ erros: [{ Codigo: "E9998", Descricao: descricao }] });
      expect(r.kind).toBe("falha");
      expect(r.kind === "falha" && r.error).toBe(`O governo diz que já recebeu essa DPS: o sistema confere pela consulta antes de qualquer outro envio. ${descricao} (E9998)`);
    }
    // Outras recusas continuam recusas.
    expect(await c({ erros: [{ Codigo: "E0714", Descricao: "Assinatura inválida" }] })).toMatchObject({ kind: "rejeitada" });
  });
  it("401/403 sem a lista de erros da Sefin não é recusa da DPS: falha (a nota não vira rejeitada)", async () => {
    for (const status of [401, 403]) {
      const r = await createSefinClient({ environment: "teste", transport: stub({ status, json: null }).transport }).emitir("<DPS/>");
      expect(r).toEqual({ kind: "falha", error: "Acesso recusado pela Sefin (confira o certificado e a configuração)." });
    }
    const r = await createSefinClient({ environment: "teste", transport: stub({ status: 403, json: { erros: [{ Codigo: "E0714", Descricao: "Assinatura inválida" }] } }).transport }).emitir("<DPS/>");
    expect(r).toMatchObject({ kind: "rejeitada", reasons: ["Assinatura inválida (E0714)"] });
  });
  it("timeout, 5xx, 429 e 2xx sem chave → falha (tentar de novo depois de consultar)", async () => {
    const c = (...a: Parameters<typeof stub>) => createSefinClient({ environment: "teste", transport: stub(...a).transport }).emitir("<DPS/>");
    expect(await c(() => { throw new Error("Tempo esgotado"); })).toEqual({ kind: "falha", error: "Sem resposta do governo: Tempo esgotado" });
    expect(await c({ status: 503, json: null })).toEqual({ kind: "falha", error: "O governo respondeu com erro (HTTP 503)." });
    expect(await c({ status: 500, json: { erros: [{ Codigo: "E999", Descricao: "Erro não catalogado" }] } })).toEqual({ kind: "falha", error: "O governo respondeu com erro (HTTP 500): Erro não catalogado (E999)" });
    expect(await c({ status: 429, json: null })).toMatchObject({ kind: "falha" });
    expect(await c({ status: 201, json: { chaveAcesso: "123" } })).toEqual({ kind: "falha", error: "O governo respondeu sem a chave de acesso (HTTP 201)." });
  });
});

describe("consultarDps", () => {
  it("200 → existe com a chave; 404 → nao_existe; E2404 → nao_existe; outro → falha", async () => {
    const c = (...a: Parameters<typeof stub>) => { const s = stub(...a); return { s, p: createSefinClient({ environment: "teste", transport: s.transport }).consultarDps(DPS_ID) }; };
    const ok = c({ status: 200, json: { chaveAcesso: CHAVE } });
    expect(await ok.p).toEqual({ kind: "existe", accessKey: CHAVE });
    expect(ok.s.calls[0]).toMatchObject({ method: "GET", url: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/dps/${DPS_ID}` });
    expect(await c({ status: 404, json: null }).p).toEqual({ kind: "nao_existe" });
    expect(await c({ status: 400, json: { erro: [{ codigo: "E2404", descricao: "Não foi gerada" }] } }).p).toEqual({ kind: "nao_existe" });
    expect(await c({ status: 500, json: null }).p).toMatchObject({ kind: "falha" });
    expect(await c({ status: 200, json: {} }).p).toMatchObject({ kind: "falha" });
    expect(await c(() => { throw new Error("ECONNRESET"); }).p).toEqual({ kind: "falha", error: "Sem resposta do governo: ECONNRESET" });
  });
  it("recusa Id fora do formato sem chamar a rede", async () => {
    const s = stub();
    expect(await createSefinClient({ environment: "teste", transport: s.transport }).consultarDps("../nfse")).toMatchObject({ kind: "falha" });
    expect(s.calls).toHaveLength(0);
  });
});

describe("cancelar", () => {
  it("POST /nfse/{chave}/eventos com o evento gzip+base64; 201 → ok; erro → motivo do governo", async () => {
    const s = stub({ status: 201, json: { eventoXmlGZipB64: gz("<evento/>") } });
    expect(await createSefinClient({ environment: "producao", transport: s.transport }).cancelar(CHAVE, "<pedRegEvento/>")).toEqual({ ok: true });
    expect(s.calls[0]).toMatchObject({ method: "POST", url: `https://sefin.nfse.gov.br/SefinNacional/nfse/${CHAVE}/eventos` });
    const body = s.calls[0].body as Record<string, string>;
    expect(Object.keys(body)).toEqual(["pedidoRegistroEventoXmlGZipB64"]);
    expect(gunzipSync(Buffer.from(body.pedidoRegistroEventoXmlGZipB64, "base64")).toString()).toBe("<pedRegEvento/>");
    const err = stub({ status: 400, json: { erros: [{ Codigo: "E1", Descricao: "Fora do prazo" }, { Codigo: "E2", Descricao: "Outro" }] } });
    expect(await createSefinClient({ environment: "teste", transport: err.transport }).cancelar(CHAVE, "<x/>")).toEqual({ ok: false, reason: "Fora do prazo (E1) · Outro (E2)" });
    const down = stub(() => { throw new Error("timeout"); });
    expect(await createSefinClient({ environment: "teste", transport: down.transport }).cancelar(CHAVE, "<x/>")).toEqual({ ok: false, reason: "Sem resposta do governo: timeout" });
    expect(await createSefinClient({ environment: "teste", transport: stub().transport }).cancelar("12", "<x/>")).toEqual({ ok: false, reason: "Chave de acesso inválida." });
  });
});

describe("transporte real", () => {
  it("SEGURANÇA: httpsTransport não é criado nos testes, nem pelo cliente sem stub", () => {
    const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
    expect(() => httpsTransport(cert)).toThrow("Transporte real desligado nos testes.");
    expect(() => createSefinClient({ environment: "teste", cert })).toThrow("Transporte real desligado nos testes.");
    expect(() => createSefinClient({ environment: "teste" })).toThrow("Sem certificado digital para falar com a Sefin.");
  });
});

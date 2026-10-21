import { request } from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import type { FiscalCert } from "./certificate";

/**
 * Cliente da Sefin Nacional (NFS-e), API síncrona em JSON com o XML em GZip + Base64, autenticada por mTLS com o A1 da Casa.
 * Conferência em fonte oficial de 18/10/2026: .superpowers/sdd/2026-10-18-fase-d-financeiro-nota/fiscal-conferencia.md (§1 a §4, §8).
 * Nunca registrar em log o XML (a DPS pode ter CPF) nem o corpo das respostas.
 */

/** CONFIRMADO em 18/10/2026 (gov.br "APIs - Prod. Restrita e Produção" + sonda de rede: 403 sem certificado nos dois). */
export const SEFIN_URL = {
  teste: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  producao: "https://sefin.nfse.gov.br/SefinNacional",
} as const;
/** CONFIRMADO em 18/10/2026 (Manual dos Contribuintes v1.2 §1.3.2, §1.4 e §1.5.2): POST /nfse, GET /dps/{id}, POST /nfse/{chave}/eventos. */
export const SEFIN_PATH = {
  emitir: "/nfse",
  consultarDps: (id: string) => `/dps/${encodeURIComponent(id)}`,
  eventos: (chave: string) => `/nfse/${encodeURIComponent(chave)}/eventos`,
} as const;

/* Nomes de campo JSON: NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. */
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. Corpo do envio da DPS. */
export const CAMPO_DPS = "dpsXmlGZipB64";
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. Chave de acesso (50 números) na resposta. */
export const CAMPO_CHAVE = "chaveAcesso";
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. XML da NFS-e autorizada. */
export const CAMPO_NFSE_XML = "nfseXmlGZipB64";
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. Lista de erros (às vezes `erro`, no singular). */
export const CAMPO_ERROS = ["erros", "erro"] as const;
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. Campos de cada erro. */
export const CAMPO_ERRO = { codigo: "Codigo", descricao: "Descricao", complemento: "Complemento" } as const;
/** NÃO CONFIRMADO no Swagger oficial (fonte: clientes open-source/fóruns), conferir na Produção Restrita. Corpo do pedido de evento. */
export const CAMPO_EVENTO = "pedidoRegistroEventoXmlGZipB64";
/** NÃO CONFIRMADO no Swagger oficial (fonte: fórum ACBr), conferir na Produção Restrita. GET /dps/{id} de DPS que não virou nota: 404 com este código. */
export const ERRO_DPS_INEXISTENTE = "E2404";
/**
 * NÃO CONFIRMADO: o código da Sefin para "DPS já recebida" (a mesma DPS mandada de novo) não está no material oficial conferido em
 * 18/10/2026; conferir na Produção Restrita e anotar no roteiro (docs/fiscal/roteiro-homologacao.md). Enquanto isso vale o TEXTO do erro:
 * recusa que diz que a DPS já existe / é duplicada quer dizer que um envio anterior chegou (timeout + atraso da consulta). Não é recusa da
 * nota: vira falha e a consulta pelo Id da DPS resolve (como a NFC-e faz com o cStat 204).
 */
export const DPS_JA_RECEBIDA = /duplic|j[aá]\s+(foi\s+)?(existe|consta|cadastrad|utilizad|emitid|gerad|enviad|recebid|informad|registrad|processad)/i;
/** NÃO CONFIRMADO (fonte: clientes open-source): o sucesso do envio vem 201; aceitamos 200 também. */
export const STATUS_SUCESSO = [200, 201] as const;
/** Tempo máximo esperando o governo (o worker tenta de novo depois). */
export const SEFIN_TIMEOUT_MS = 30_000;
/** Teto do corpo da resposta: passou disso, a conexão é cortada e vira falha (uma NFS-e tem poucos KB). */
export const SEFIN_MAX_RESPOSTA_BYTES = 5 * 1024 * 1024;
/** 401/403 sem a lista de erros da Sefin: barrado na porta (certificado, mTLS, configuração), não é recusa da DPS. */
export const ACESSO_RECUSADO = "Acesso recusado pela Sefin (confira o certificado e a configuração).";

export type SefinTransport = (r: { method: "GET" | "HEAD" | "POST"; url: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;
export type SefinResult =
  | { kind: "autorizada"; accessKey: string; nfseXml: string; raw: unknown }
  | { kind: "rejeitada"; reasons: string[]; raw: unknown }
  | { kind: "falha"; error: string }; // rede, timeout, 5xx: tentar de novo

const gz64 = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
const ungz64 = (b64: string) => { try { return gunzipSync(Buffer.from(b64, "base64")).toString("utf8"); } catch { return ""; } };
const isOk = (status: number) => (STATUS_SUCESSO as readonly number[]).includes(status);

/** Lê um campo sem diferenciar maiúsculas (a Sefin varia entre idDps/idDPS, erros/Erros, Codigo/codigo). */
function field(o: unknown, name: string): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : (o as Record<string, unknown>)[k];
}
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const accessKeyOf = (json: unknown) => { const k = text(field(json, CAMPO_CHAVE)); return /^[0-9]{50}$/.test(k) ? k : null; };

type SefinErro = { codigo: string; descricao: string; complemento: string };
function errorsOf(json: unknown): SefinErro[] {
  const raw = CAMPO_ERROS.map((n) => field(json, n)).find((v) => v != null);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map((e) => ({ codigo: text(field(e, CAMPO_ERRO.codigo)), descricao: text(field(e, CAMPO_ERRO.descricao)), complemento: text(field(e, CAMPO_ERRO.complemento)) }))
    .filter((e) => e.codigo || e.descricao);
}
const errText = (e: SefinErro) => `${e.descricao || "Erro sem descrição"}${e.complemento ? `: ${e.complemento}` : ""}${e.codigo ? ` (${e.codigo})` : ""}`;
const offline = (e: unknown) => `Sem resposta do governo: ${e instanceof Error ? e.message : String(e)}`;
/** 408 e 429 são "tente depois", não recusa da nota. */
const isRejection = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

export function createSefinClient(o: { environment: "teste" | "producao"; transport?: SefinTransport; cert?: FiscalCert }) {
  const base = SEFIN_URL[o.environment];
  const transport = o.transport ?? (o.cert ? httpsTransport(o.cert) : null);
  if (!transport) throw new Error("Sem certificado digital para falar com a Sefin.");

  return {
    /** Envia a DPS assinada. 2xx sem chave é ambíguo: vira falha e o worker consulta a DPS antes de reenviar. */
    async emitir(signedDpsXml: string): Promise<SefinResult> {
      let r: { status: number; json: unknown };
      try { r = await transport({ method: "POST", url: base + SEFIN_PATH.emitir, body: { [CAMPO_DPS]: gz64(signedDpsXml) } }); }
      catch (e) { return { kind: "falha", error: offline(e) }; }
      if (isOk(r.status)) {
        const accessKey = accessKeyOf(r.json);
        if (!accessKey) return { kind: "falha", error: `O governo respondeu sem a chave de acesso (HTTP ${r.status}).` };
        const b64 = text(field(r.json, CAMPO_NFSE_XML));
        return { kind: "autorizada", accessKey, nfseXml: b64 ? ungz64(b64) : "", raw: r.json };
      }
      const erros = errorsOf(r.json), errs = erros.map(errText);
      if (isRejection(r.status)) {
        if (erros.some((e) => DPS_JA_RECEBIDA.test(`${e.descricao} ${e.complemento}`)))
          return { kind: "falha", error: `O governo diz que já recebeu essa DPS: o sistema confere pela consulta antes de qualquer outro envio. ${errs.join(" · ")}` };
        if (errs.length) return { kind: "rejeitada", reasons: errs, raw: r.json };
        if (r.status === 401 || r.status === 403) return { kind: "falha", error: ACESSO_RECUSADO };
        return { kind: "rejeitada", reasons: [`O governo recusou o envio (HTTP ${r.status}).`], raw: r.json };
      }
      return { kind: "falha", error: `O governo respondeu com erro (HTTP ${r.status})${errs.length ? `: ${errs.join(" · ")}` : "."}` };
    },

    /** A DPS já virou nota? Usado antes de reenviar, para nunca duplicar. */
    async consultarDps(id: string): Promise<{ kind: "existe"; accessKey: string } | { kind: "nao_existe" } | { kind: "falha"; error: string }> {
      if (!/^DPS[0-9A-Z]{42}$/.test(id)) return { kind: "falha", error: "Id da DPS inválido." };
      let r: { status: number; json: unknown };
      try { r = await transport({ method: "GET", url: base + SEFIN_PATH.consultarDps(id) }); }
      catch (e) { return { kind: "falha", error: offline(e) }; }
      if (isOk(r.status)) {
        const accessKey = accessKeyOf(r.json);
        return accessKey ? { kind: "existe", accessKey } : { kind: "falha", error: `O governo respondeu sem a chave de acesso (HTTP ${r.status}).` };
      }
      if (r.status === 404 || errorsOf(r.json).some((e) => e.codigo.toUpperCase() === ERRO_DPS_INEXISTENTE)) return { kind: "nao_existe" };
      const errs = errorsOf(r.json).map(errText);
      return { kind: "falha", error: `O governo respondeu com erro (HTTP ${r.status})${errs.length ? `: ${errs.join(" · ")}` : "."}` };
    },

    /** Registra o evento de cancelamento (e101101) já assinado. */
    async cancelar(accessKey: string, signedEventXml: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (!/^[0-9]{50}$/.test(accessKey)) return { ok: false, reason: "Chave de acesso inválida." };
      let r: { status: number; json: unknown };
      try { r = await transport({ method: "POST", url: base + SEFIN_PATH.eventos(accessKey), body: { [CAMPO_EVENTO]: gz64(signedEventXml) } }); }
      catch (e) { return { ok: false, reason: offline(e) }; }
      if (isOk(r.status)) return { ok: true };
      const errs = errorsOf(r.json).map(errText);
      return { ok: false, reason: errs.length ? errs.join(" · ") : r.status === 401 || r.status === 403 ? ACESSO_RECUSADO : `O governo recusou o cancelamento (HTTP ${r.status}).` };
    },
  };
}

/**
 * Transporte de verdade: node:https com o certificado e a chave da Casa (mTLS), JSON, timeout padrão de 30 s. O certificado do servidor é
 * conferido: se a cadeia ICP-Brasil faltar, use `NODE_EXTRA_CA_CERTS=<cadeia ICP-Brasil .pem>` no ambiente do processo (pm2), sem desligar
 * a verificação (docs/fiscal/roteiro-homologacao.md).
 * SEGURANÇA: nunca é criado nos testes (os testes usam um transporte de mentira); nenhum teste fala com a Sefin.
 */
export function httpsTransport(cert: FiscalCert, timeoutMs = SEFIN_TIMEOUT_MS): SefinTransport {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) throw new Error("Transporte real desligado nos testes.");
  return (r) => new Promise((resolve, reject) => {
    const u = new URL(r.url);
    const payload = r.body === undefined ? null : JSON.stringify(r.body);
    const req = request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: r.method, timeout: timeoutMs,
      cert: [cert.certPem, ...cert.chainPem].join("\n"), key: cert.keyPem, // folha primeiro, depois a cadeia do .pfx
      headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > SEFIN_MAX_RESPOSTA_BYTES) { req.destroy(new Error("resposta grande demais (mais de 5 MB)")); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try { json = body ? JSON.parse(body) : null; } catch { json = null; }
        resolve({ status: res.statusCode ?? 0, json });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`tempo esgotado (${Math.round(timeoutMs / 1000)} s)`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

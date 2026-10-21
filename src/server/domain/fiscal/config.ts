import { and, eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, fiscalDocuments, professionals, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { loadFiscalCert } from "./certificate";
import { can } from "@/lib/permissions";
import { isValidCnpj } from "@/lib/cnpj";
import {
  certExpiryWarning, FISCAL_REGRAS_LIMITES, isAliquotaIssBp, FISCAL_TEXT_VARS, isFiscalModo, readFiscalEmpresa, readFiscalRegras, unknownFiscalVars,
  type FiscalEmpresa, type FiscalModo, type FiscalRegras, type FiscalTextKey,
} from "@/lib/fiscal-settings";

const EMPRESA = "fiscal_empresa", REGRAS = "fiscal_regras";
const MODO = { nfse: "nfse_modo", nfce: "nfce_modo" } as const;
const NO_PERM = "Você não tem permissão para configurar a nota fiscal.";
const need = (actor: Actor) => { if (!can(actor.perms, "nota.configurar")) throw new UserFacingError(NO_PERM); };

async function read(key: string, q: Tx | Db = db): Promise<unknown> {
  const [r] = await q.select().from(settings).where(eq(settings.key, key));
  return r?.value;
}
async function write(tx: Tx, key: string, value: unknown) {
  await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getFiscalEmpresa(q: Tx | Db = db): Promise<FiscalEmpresa> { return readFiscalEmpresa(await read(EMPRESA, q)); }
export async function getFiscalRegras(q: Tx | Db = db): Promise<FiscalRegras> { return readFiscalRegras(await read(REGRAS, q)); }
async function getModo(kind: "nfse" | "nfce", q: Tx | Db = db): Promise<FiscalModo> {
  const v = await read(MODO[kind], q);
  return isFiscalModo(v) ? v : "desligada";
}
export const getNfseModo = (q: Tx | Db = db) => getModo("nfse", q);
export const getNfceModo = (q: Tx | Db = db) => getModo("nfce", q);

/** Dados da Casa (Configurações › Nota fiscal › Dados da Casa); pede `nota.configurar` e audita de/para. */
export async function saveFiscalEmpresa(i: FiscalEmpresa, actor: Actor): Promise<void> {
  need(actor);
  const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  if (i.cnpj && !isValidCnpj(i.cnpj)) throw new UserFacingError("CNPJ inválido.");
  if (!/^[0-9]{6}$/.test(i.cTribNacPadrao ?? "")) throw new UserFacingError("O código do serviço na nota (cTribNac) tem 6 números.");
  if (i.nbsPadrao && !/^[0-9]{9}$/.test(i.nbsPadrao)) throw new UserFacingError("O NBS tem 9 números.");
  // M-6: nada é descartado em silêncio (a leitura tolerante cortaria o texto e jogaria fora o endereço pela metade).
  const txt = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
  for (const [v, max, msg] of [
    [i.razaoSocial, 150, "A razão social"], [i.inscricaoMunicipal, 20, "A inscrição municipal"], [i.inscricaoEstadual, 20, "A inscrição estadual"],
  ] as const) if (txt(v).length > max) throw new UserFacingError(`${msg} passa de ${max} caracteres.`);
  const end = i.endereco ? { logradouro: txt(i.endereco.logradouro), numero: txt(i.endereco.numero), bairro: txt(i.endereco.bairro), cep: digits(i.endereco.cep) } : null;
  const partes = end ? Object.values(end) : [];
  if (partes.some(Boolean) && !partes.every(Boolean)) throw new UserFacingError("Preencha o endereço inteiro (rua, número, bairro e CEP) ou deixe tudo vazio.");
  const endereco = end && partes.every(Boolean) ? end : null;
  if (endereco) {
    if (endereco.cep.length !== 8) throw new UserFacingError("O CEP tem 8 números.");
    for (const [v, max, msg] of [[endereco.logradouro, 120, "A rua"], [endereco.numero, 20, "O número do endereço"], [endereco.bairro, 80, "O bairro"]] as const)
      if (v.length > max) throw new UserFacingError(`${msg} passa de ${max} caracteres.`);
  }
  if (i.aliquotaSimplesBp != null && (!Number.isInteger(i.aliquotaSimplesBp) || i.aliquotaSimplesBp < 0 || i.aliquotaSimplesBp > 10000)) throw new UserFacingError("A alíquota do Simples fica entre 0% e 100%.");
  if (i.aliquotaIssBp != null && !isAliquotaIssBp(i.aliquotaIssBp)) throw new UserFacingError("A alíquota do ISS fica entre 2% e 5%.");
  for (const [n, v] of [["do DPS", i.serieDps], ["da NFC-e", i.serieNfce]] as const) if (!Number.isInteger(v) || v < 1 || v > 999) throw new UserFacingError(`A série ${n} vai de 1 a 999.`);
  const para = readFiscalEmpresa({ ...i, cnpj: i.cnpj ? digits(i.cnpj) : null, endereco });
  await db.transaction(async (tx) => {
    const de = await getFiscalEmpresa(tx);
    await write(tx, EMPRESA, para);
    await tx.insert(auditLog).values({ userId: actor.id, action: "fiscal_empresa", entity: "settings", entityId: EMPRESA, data: { de, para } });
  });
}

const FIELD_LABEL = { tentativasMax: "Tentativas de envio", esperaMaxMin: "Espera máxima entre tentativas", certAvisoDias: "Avisar o vencimento do certificado", nfceCancelarAteMin: "Cancelar a NFC-e até" } as const;
export const FISCAL_TEXT_LABEL: Record<FiscalTextKey, string> = { servicos: "Serviços", parceria: "Parceria", cotaParceira: "Cota de cada parceira" };

/** Regras e textos da nota (Configurações › Nota fiscal › Regras e textos); pede `nota.configurar` e audita de/para. */
export async function setFiscalRegras(r: FiscalRegras, actor: Actor): Promise<void> {
  need(actor);
  for (const k of Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]) {
    const [min, max] = FISCAL_REGRAS_LIMITES[k];
    if (!Number.isInteger(r[k]) || r[k] < min || r[k] > max) throw new UserFacingError(`Em "${FIELD_LABEL[k]}", use de ${min} a ${max}.`);
  }
  if (r.assinaturaNfse !== "sha1" && r.assinaturaNfse !== "sha256") throw new UserFacingError("Escolha SHA-1 ou SHA-256 para a assinatura da NFS-e.");
  for (const k of Object.keys(FISCAL_TEXT_VARS) as FiscalTextKey[]) {
    const t = r.textos[k];
    if (typeof t !== "string" || !t.trim()) throw new UserFacingError(`O texto "${FISCAL_TEXT_LABEL[k]}" não pode ficar vazio.`);
    if (t.length > 600) throw new UserFacingError(`O texto "${FISCAL_TEXT_LABEL[k]}" passa de 600 caracteres.`);
    const bad = unknownFiscalVars(k, t);
    if (bad.length) throw new UserFacingError(`No texto "${FISCAL_TEXT_LABEL[k]}", a variável {${bad[0]}} não existe. Use: ${FISCAL_TEXT_VARS[k].map((v) => `{${v}}`).join(", ")}.`);
  }
  const para: FiscalRegras = { ...r, rascunhoNaComanda: !!r.rascunhoNaComanda, informarAliquotaNaDps: !!r.informarAliquotaNaDps, textos: { servicos: r.textos.servicos, parceria: r.textos.parceria, cotaParceira: r.textos.cotaParceira } };
  await db.transaction(async (tx) => {
    const de = await getFiscalRegras(tx);
    await write(tx, REGRAS, para);
    await tx.insert(auditLog).values({ userId: actor.id, action: "fiscal_regras", entity: "settings", entityId: REGRAS, data: { de, para } });
  });
}

type ReadinessOpts = {
  /** Variáveis do servidor (padrão: process.env). O certificado é aberto de verdade (FISCAL_CERT_PATH + FISCAL_CERT_PASSWORD). */ env?: Record<string, string | undefined>;
  now?: Date;
};

/** O que falta para emitir. As frases são fixas (a tela e os testes dependem delas). Segredos: só a presença das variáveis do servidor. */
export async function fiscalReadiness(kind: "nfse" | "nfce", opts: ReadinessOpts = {}): Promise<{ ok: boolean; missing: string[] }> {
  const e = opts.env ?? process.env;
  const [c, regras, parceiras] = await Promise.all([
    getFiscalEmpresa(), getFiscalRegras(),
    db.select({ name: professionals.name, cnpj: professionals.cnpj }).from(professionals).where(and(eq(professionals.active, true), eq(professionals.bond, "parceira"))).orderBy(professionals.name),
  ]);
  const missing: string[] = [];
  if (!c.cnpj) missing.push("CNPJ da Casa");
  // A NFC-e (produto) não leva a inscrição municipal nem as parceiras; leva a IE, a razão social e o endereço no emitente.
  if (kind === "nfse" && !c.inscricaoMunicipal) missing.push("Inscrição municipal");
  if (kind === "nfce" && !c.inscricaoEstadual) missing.push("Inscrição estadual");
  if (!c.regime) missing.push("Regime tributário");
  // A NFC-e do CRM só sai no Simples Nacional (CRT 1 e CSOSN): outro regime é recusado na emissão.
  else if (kind === "nfce" && c.regime !== "simples") missing.push("Regime Simples Nacional");
  if (kind === "nfse" && regras.informarAliquotaNaDps && c.aliquotaIssBp == null) missing.push("Alíquota do ISS");
  if (kind === "nfce" && !c.razaoSocial) missing.push("Razão social da Casa");
  if (kind === "nfce" && !c.endereco) missing.push("Endereço da Casa");
  if (!e.FISCAL_CERT_PATH || !e.FISCAL_CERT_PASSWORD) missing.push("Certificado digital A1 no servidor");
  else {
    // Abre o .pfx para ler a validade real; senha errada ou arquivo sumido também é "o que falta" (frase do erro, sem o ponto final).
    try { const w = certExpiryWarning((await loadFiscalCert(e))?.notAfter ?? null, regras.certAvisoDias, opts.now); if (w) missing.push(w); }
    catch (err) {
      if (!(err instanceof UserFacingError)) throw err;
      missing.push(`Certificado digital A1 não abre: ${err.message.charAt(0).toLowerCase()}${err.message.slice(1).replace(/\.$/, "")}`);
    }
  }
  if (kind === "nfce" && (!e.NFCE_CSC || !e.NFCE_CSC_ID)) missing.push("CSC da SEFAZ-BA no servidor");
  if (kind === "nfse") for (const p of parceiras) if (!p.cnpj || !isValidCnpj(p.cnpj)) missing.push(`Parceira ${p.name} sem CNPJ`);
  return { ok: missing.length === 0, missing };
}

const NOME_DA_NOTA = { nfse: "uma nota", nfce: "uma NFC-e" } as const;

/**
 * A chave de cada nota: Desligada, Teste ou Produção (pede `nota.configurar`). A Produção só é aceita com a prontidão completa daquela nota
 * e pelo menos uma nota DAQUELE tipo autorizada no Teste. As duas chaves são independentes.
 */
async function setModo(kind: "nfse" | "nfce", m: FiscalModo, actor: Actor, opts: ReadinessOpts): Promise<void> {
  need(actor);
  if (!isFiscalModo(m)) throw new UserFacingError("Escolha Desligada, Teste ou Produção.");
  if (m === "producao") {
    const [ok] = await db.select({ id: fiscalDocuments.id }).from(fiscalDocuments)
      .where(and(eq(fiscalDocuments.kind, kind), eq(fiscalDocuments.environment, "teste"), eq(fiscalDocuments.status, "autorizada"))).limit(1);
    if (!ok) throw new UserFacingError(`Antes da produção, emita e confira ${NOME_DA_NOTA[kind]} no modo Teste.`);
    const r = await fiscalReadiness(kind, opts);
    if (!r.ok) throw new UserFacingError(`Faltam dados para emitir de verdade: ${r.missing.join(", ")}.`);
  }
  await db.transaction(async (tx) => {
    const de = await getModo(kind, tx);
    await write(tx, MODO[kind], m);
    await tx.insert(auditLog).values({ userId: actor.id, action: "fiscal_modo", entity: "settings", entityId: MODO[kind], data: { chave: MODO[kind], de, para: m } });
  });
}
/** A chave da NFS-e (nota de serviço). */
export const setNfseModo = (m: FiscalModo, actor: Actor, opts: ReadinessOpts = {}) => setModo("nfse", m, actor, opts);
/** A chave da NFC-e (nota do produto, Task 13). */
export const setNfceModo = (m: FiscalModo, actor: Actor, opts: ReadinessOpts = {}) => setModo("nfce", m, actor, opts);

import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, fiscalDocuments, professionals } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { TEST_PFX_PASSWORD, writeTestPfx } from "../../../../test/fiscal-cert";
import { DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS, type FiscalEmpresa } from "@/lib/fiscal-settings";
import type { Actor } from "../agenda/actor";
import { openWalkInComanda } from "../caixa/comandas";
import { fiscalReadiness, getFiscalEmpresa, getFiscalRegras, getNfceModo, getNfseModo, saveFiscalEmpresa, setFiscalRegras, setNfceModo, setNfseModo } from "./config";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const without = (a: Actor, ...p: string[]): Actor => ({ ...a, perms: a.perms.filter((x) => !p.includes(x)) });
const logs = async (action: string) => (await db.select().from(auditLog).where(eq(auditLog.action, action))).map((a) => a.data);
const completa: FiscalEmpresa = { ...DEFAULT_FISCAL_EMPRESA, cnpj: "11222333000181", razaoSocial: "Casa Fiaes Ltda", inscricaoMunicipal: "123456", regime: "simples", aliquotaSimplesBp: 600 };
/** O PFX de teste (vence em 2027) gravado no os.tmpdir(): a prontidão abre o certificado de verdade. */
let ENV_OK: { FISCAL_CERT_PATH: string; FISCAL_CERT_PASSWORD: string };
beforeAll(async () => { ENV_OK = { FISCAL_CERT_PATH: await writeTestPfx(), FISCAL_CERT_PASSWORD: TEST_PFX_PASSWORD }; });

beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

describe("dados da Casa", () => {
  it("padrão vazio; salvar valida, grava e audita de/para", async () => {
    expect(await getFiscalEmpresa()).toEqual(DEFAULT_FISCAL_EMPRESA);
    await expect(saveFiscalEmpresa({ ...completa, cnpj: "11222333000180" }, s.caixaGestao)).rejects.toThrow("CNPJ inválido.");
    await expect(saveFiscalEmpresa({ ...completa, cTribNacPadrao: "12" }, s.caixaGestao)).rejects.toThrow("O código do serviço na nota (cTribNac) tem 6 números.");
    await saveFiscalEmpresa(completa, s.caixaGestao);
    expect(await getFiscalEmpresa()).toEqual(completa);
    const [l] = await logs("fiscal_empresa") as { de: FiscalEmpresa; para: FiscalEmpresa }[];
    expect(l.de.cnpj).toBeNull();
    expect(l.para.cnpj).toBe("11222333000181");
  });
  it("M-6: endereço pela metade e campos acima do tamanho são recusados no servidor com frase (nada é descartado em silêncio)", async () => {
    const END = { logradouro: "Rua das Flores", numero: "10", bairro: "Pituba", cep: "41810-000" };
    await expect(saveFiscalEmpresa({ ...completa, endereco: { ...END, numero: " ", bairro: "" } }, s.caixaGestao))
      .rejects.toThrow("Preencha o endereço inteiro (rua, número, bairro e CEP) ou deixe tudo vazio.");
    await expect(saveFiscalEmpresa({ ...completa, endereco: { ...END, cep: "4181" } }, s.caixaGestao)).rejects.toThrow("O CEP tem 8 números.");
    for (const [patch, msg] of [
      [{ razaoSocial: "x".repeat(151) }, "A razão social passa de 150 caracteres."],
      [{ inscricaoMunicipal: "1".repeat(21) }, "A inscrição municipal passa de 20 caracteres."],
      [{ inscricaoEstadual: "1".repeat(21) }, "A inscrição estadual passa de 20 caracteres."],
      [{ endereco: { ...END, logradouro: "R".repeat(121) } }, "A rua passa de 120 caracteres."],
      [{ endereco: { ...END, numero: "1".repeat(21) } }, "O número do endereço passa de 20 caracteres."],
      [{ endereco: { ...END, bairro: "B".repeat(81) } }, "O bairro passa de 80 caracteres."],
    ] as const) await expect(saveFiscalEmpresa({ ...completa, ...patch } as FiscalEmpresa, s.caixaGestao)).rejects.toThrow(msg);
    expect(await getFiscalEmpresa()).toEqual(DEFAULT_FISCAL_EMPRESA); // nada gravou
    // Endereço todo vazio = sem endereço; completo grava inteiro.
    await saveFiscalEmpresa({ ...completa, endereco: { logradouro: " ", numero: "", bairro: "", cep: "" } }, s.caixaGestao);
    expect((await getFiscalEmpresa()).endereco).toBeNull();
    await saveFiscalEmpresa({ ...completa, endereco: END }, s.caixaGestao);
    expect((await getFiscalEmpresa()).endereco).toEqual({ ...END, cep: "41810000" });
  });
  it("sem nota.configurar, recusa no servidor (config.sistema e caixa.gerir não bastam)", async () => {
    const a = without(s.caixaGestao, "nota.configurar");
    expect(a.perms).toContain("config.sistema");
    await expect(saveFiscalEmpresa(completa, a)).rejects.toThrow("Você não tem permissão para configurar a nota fiscal.");
    await expect(setNfseModo("teste", a)).rejects.toThrow("Você não tem permissão para configurar a nota fiscal.");
    await expect(setFiscalRegras(DEFAULT_FISCAL_REGRAS, a)).rejects.toThrow("Você não tem permissão para configurar a nota fiscal.");
    await expect(saveFiscalEmpresa(completa, s.caixaRecepcao)).rejects.toThrow();
    expect(await getFiscalEmpresa()).toEqual(DEFAULT_FISCAL_EMPRESA);
  });
});

describe("a chave", () => {
  it("nasce desligada; teste liga; produção exige uma nota autorizada em teste e a prontidão completa", async () => {
    expect(await getNfseModo()).toBe("desligada");
    expect(await getNfceModo()).toBe("desligada");
    await setNfseModo("teste", s.caixaGestao);
    expect(await getNfseModo()).toBe("teste");
    await expect(setNfseModo("producao", s.caixaGestao, { env: ENV_OK })).rejects.toThrow("Antes da produção, emita e confira uma nota no modo Teste.");
    // Com uma nota de teste autorizada, falta ainda a prontidão (a Casa está sem dados).
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await db.insert(fiscalDocuments).values({ comandaId: w.comandaId, kind: "nfse", environment: "teste", series: 1, number: 1, localId: "DPS1", status: "autorizada", amountCents: 1000 });
    await expect(setNfseModo("producao", s.caixaGestao, { env: ENV_OK })).rejects.toThrow("Faltam dados para emitir de verdade: CNPJ da Casa, Inscrição municipal, Regime tributário.");
    await saveFiscalEmpresa(completa, s.caixaGestao);
    await setNfseModo("producao", s.caixaGestao, { env: ENV_OK });
    expect(await getNfseModo()).toBe("producao");
    await setNfseModo("desligada", s.caixaGestao);
    expect(await getNfseModo()).toBe("desligada");
    expect((await logs("fiscal_modo")).at(-1)).toEqual({ chave: "nfse_modo", de: "producao", para: "desligada" });
    await expect(setNfseModo("ligada" as never, s.caixaGestao)).rejects.toThrow("Escolha Desligada, Teste ou Produção.");
  });
  it("nota de teste cancelada ou de outra comanda em produção não conta", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await db.insert(fiscalDocuments).values({ comandaId: w.comandaId, kind: "nfse", environment: "producao", series: 1, number: 1, localId: "DPS1", status: "autorizada", amountCents: 1000 });
    await saveFiscalEmpresa(completa, s.caixaGestao);
    await expect(setNfseModo("producao", s.caixaGestao, { env: ENV_OK })).rejects.toThrow("Antes da produção, emita e confira uma nota no modo Teste.");
  });
});

describe("a chave da NFC-e (Task 13)", () => {
  const ENDERECO = { logradouro: "Rua das Flores", numero: "10", bairro: "Pituba", cep: "41810000" };
  it("pede nota.configurar; teste liga sem mexer na NFS-e; produção exige uma NFC-e autorizada em teste e a prontidão da NFC-e", async () => {
    await expect(setNfceModo("teste", without(s.caixaGestao, "nota.configurar"))).rejects.toThrow("Você não tem permissão para configurar a nota fiscal.");
    expect(await getNfceModo()).toBe("desligada");
    await setNfceModo("teste", s.caixaGestao);
    expect(await getNfceModo()).toBe("teste");
    expect(await getNfseModo()).toBe("desligada");
    const env = { ...ENV_OK, NFCE_CSC: "csc-ficticio", NFCE_CSC_ID: "1" };
    await expect(setNfceModo("producao", s.caixaGestao, { env })).rejects.toThrow("Antes da produção, emita e confira uma NFC-e no modo Teste.");
    // Uma NFS-e autorizada no teste não vale para a NFC-e.
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await db.insert(fiscalDocuments).values({ comandaId: w.comandaId, kind: "nfse", environment: "teste", series: 1, number: 1, localId: "DPS1", status: "autorizada", amountCents: 1000 });
    await expect(setNfceModo("producao", s.caixaGestao, { env })).rejects.toThrow("Antes da produção, emita e confira uma NFC-e no modo Teste.");
    await db.insert(fiscalDocuments).values({ comandaId: w.comandaId, kind: "nfce", environment: "teste", series: 1, number: 1, localId: "NFe1", status: "autorizada", amountCents: 1000 });
    await expect(setNfceModo("producao", s.caixaGestao, { env })).rejects.toThrow("Faltam dados para emitir de verdade: CNPJ da Casa, Inscrição estadual, Regime tributário, Razão social da Casa, Endereço da Casa.");
    await saveFiscalEmpresa({ ...completa, inscricaoEstadual: "123456789", endereco: ENDERECO }, s.caixaGestao);
    await expect(setNfceModo("producao", s.caixaGestao, { env: ENV_OK })).rejects.toThrow("Faltam dados para emitir de verdade: CSC da SEFAZ-BA no servidor.");
    await setNfceModo("producao", s.caixaGestao, { env });
    expect(await getNfceModo()).toBe("producao");
    expect(await getNfseModo()).toBe("desligada");
    expect((await logs("fiscal_modo")).at(-1)).toEqual({ chave: "nfce_modo", de: "teste", para: "producao" });
    await expect(setNfceModo("ligada" as never, s.caixaGestao)).rejects.toThrow("Escolha Desligada, Teste ou Produção.");
  });
  it("a prontidão da NFC-e não pede IM nem o CNPJ das parceiras (a NFC-e é só do produto)", async () => {
    await saveFiscalEmpresa({ ...completa, inscricaoMunicipal: null, inscricaoEstadual: "123456789", endereco: ENDERECO }, s.caixaGestao);
    await db.update(professionals).set({ bond: "parceira" }).where(eq(professionals.id, s.ana.id));
    expect(await fiscalReadiness("nfce", { env: { ...ENV_OK, NFCE_CSC: "csc-ficticio", NFCE_CSC_ID: "1" } })).toEqual({ ok: true, missing: [] });
    expect((await fiscalReadiness("nfse", { env: ENV_OK })).missing).toEqual(["Inscrição municipal", `Parceira ${s.ana.name} sem CNPJ`]);
    // Regime fora do Simples: a NFC-e do CRM não sai (a NFS-e segue valendo).
    await saveFiscalEmpresa({ ...completa, regime: "presumido", inscricaoEstadual: "123456789", endereco: ENDERECO }, s.caixaGestao);
    expect((await fiscalReadiness("nfce", { env: { ...ENV_OK, NFCE_CSC: "csc-ficticio", NFCE_CSC_ID: "1" } })).missing).toEqual(["Regime Simples Nacional"]);
    expect((await fiscalReadiness("nfse", { env: ENV_OK })).missing).not.toContain("Regime Simples Nacional");
  });
});

describe("prontidão", () => {
  it("lista o que falta, com as frases fixas", async () => {
    let r = await fiscalReadiness("nfse", { env: {} });
    expect(r).toEqual({ ok: false, missing: ["CNPJ da Casa", "Inscrição municipal", "Regime tributário", "Certificado digital A1 no servidor"] });
    r = await fiscalReadiness("nfce", { env: {} });
    expect(r.missing).toEqual(expect.arrayContaining(["Inscrição estadual", "CSC da SEFAZ-BA no servidor"]));
    expect((await fiscalReadiness("nfse", { env: {} })).missing).not.toContain("Inscrição estadual");
    await saveFiscalEmpresa(completa, s.caixaGestao);
    expect(await fiscalReadiness("nfse", { env: ENV_OK })).toEqual({ ok: true, missing: [] });
    expect((await fiscalReadiness("nfse", { env: { FISCAL_CERT_PATH: "/x" } })).missing).toEqual(["Certificado digital A1 no servidor"]);
    expect((await fiscalReadiness("nfce", { env: { ...ENV_OK, NFCE_CSC: "a" } })).missing).toEqual(["Inscrição estadual", "Endereço da Casa", "CSC da SEFAZ-BA no servidor"]);
  });
  it("uma frase por parceira ativa sem CNPJ válido", async () => {
    await saveFiscalEmpresa(completa, s.caixaGestao);
    await db.update(professionals).set({ bond: "parceira" }).where(eq(professionals.id, s.ana.id));
    await db.update(professionals).set({ bond: "parceira", cnpj: "11222333000181" }).where(eq(professionals.id, s.bia.id));
    expect((await fiscalReadiness("nfse", { env: ENV_OK })).missing).toEqual([`Parceira ${s.ana.name} sem CNPJ`]);
    await db.update(professionals).set({ active: false }).where(eq(professionals.id, s.ana.id));
    expect((await fiscalReadiness("nfse", { env: ENV_OK })).ok).toBe(true);
  });
  it("Regra do dono: o aviso de validade vem do certificado e segue fiscal_regras.certAvisoDias", async () => {
    await saveFiscalEmpresa(completa, s.caixaGestao);
    const now = new Date("2026-10-18T12:00:00Z");
    const env = { ...ENV_OK, FISCAL_CERT_PATH: await writeTestPfx({ notAfter: new Date("2026-11-07T12:00:00Z") }) }; // vence 20 dias depois
    expect((await fiscalReadiness("nfse", { env, now })).missing).toEqual(["Certificado vence em 20 dias"]);
    await setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, certAvisoDias: 10 }, s.caixaGestao);
    expect(await fiscalReadiness("nfse", { env, now })).toEqual({ ok: true, missing: [] });
    await setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, certAvisoDias: 60 }, s.caixaGestao);
    expect((await fiscalReadiness("nfse", { env, now })).ok).toBe(false);
    expect(await fiscalReadiness("nfse", { env: ENV_OK, now })).toEqual({ ok: true, missing: [] });
  });
  it("certificado vencido, senha errada ou arquivo sumido aparecem na prontidão (e barram a produção)", async () => {
    await saveFiscalEmpresa(completa, s.caixaGestao);
    const now = new Date("2026-10-18T12:00:00Z");
    const vencido = { ...ENV_OK, FISCAL_CERT_PATH: await writeTestPfx({ notAfter: new Date("2026-10-01T00:00:00Z") }) };
    expect((await fiscalReadiness("nfse", { env: vencido, now })).missing).toEqual(["Certificado vencido"]);
    expect((await fiscalReadiness("nfse", { env: { ...ENV_OK, FISCAL_CERT_PASSWORD: "errada" } })).missing).toEqual(["Certificado digital A1 não abre: senha do certificado não confere"]);
    expect((await fiscalReadiness("nfse", { env: { ...ENV_OK, FISCAL_CERT_PATH: "/x/casa.pfx" } })).missing).toEqual(["Certificado digital A1 não abre: o arquivo do certificado não foi encontrado no servidor"]);
    const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    await db.insert(fiscalDocuments).values({ comandaId: w.comandaId, kind: "nfse", environment: "teste", series: 1, number: 1, localId: "DPS1", status: "autorizada", amountCents: 1000 });
    await expect(setNfseModo("producao", s.caixaGestao, { env: vencido, now })).rejects.toThrow("Faltam dados para emitir de verdade: Certificado vencido.");
  });
});

describe("alíquota do ISS", () => {
  it("Regra do dono: com 'Informar a alíquota na nota' ligado, a prontidão pede a alíquota do ISS; fora de 2% a 5% é recusada", async () => {
    await saveFiscalEmpresa(completa, s.caixaGestao);
    expect(await fiscalReadiness("nfse", { env: ENV_OK })).toEqual({ ok: true, missing: [] });
    await setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, informarAliquotaNaDps: true }, s.caixaGestao);
    expect((await fiscalReadiness("nfse", { env: ENV_OK })).missing).toEqual(["Alíquota do ISS"]);
    expect((await fiscalReadiness("nfce", { env: { ...ENV_OK, NFCE_CSC: "a", NFCE_CSC_ID: "1" } })).missing).not.toContain("Alíquota do ISS");
    await expect(saveFiscalEmpresa({ ...completa, aliquotaIssBp: 600 }, s.caixaGestao)).rejects.toThrow("A alíquota do ISS fica entre 2% e 5%.");
    await saveFiscalEmpresa({ ...completa, aliquotaIssBp: 300 }, s.caixaGestao);
    expect((await getFiscalEmpresa()).aliquotaIssBp).toBe(300);
    expect(await fiscalReadiness("nfse", { env: ENV_OK })).toEqual({ ok: true, missing: [] });
  });
});

describe("regras e textos", () => {
  it("padrão; salvar grava e audita de/para; o número novo vale", async () => {
    expect(await getFiscalRegras()).toEqual(DEFAULT_FISCAL_REGRAS);
    const para = { ...DEFAULT_FISCAL_REGRAS, tentativasMax: 5, assinaturaNfse: "sha256" as const };
    await setFiscalRegras(para, s.caixaGestao);
    expect((await getFiscalRegras()).tentativasMax).toBe(5);
    expect((await getFiscalRegras()).assinaturaNfse).toBe("sha256");
    const [l] = await logs("fiscal_regras") as { de: { tentativasMax: number }; para: { tentativasMax: number } }[];
    expect([l.de.tentativasMax, l.para.tentativasMax]).toEqual([10, 5]);
  });
  it("recusa número fora da faixa, texto vazio e variável desconhecida, com frase clara", async () => {
    await expect(setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, tentativasMax: 51 }, s.caixaGestao)).rejects.toThrow("Em \"Tentativas de envio\", use de 1 a 50.");
    await expect(setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, nfceCancelarAteMin: 0 }, s.caixaGestao)).rejects.toThrow("use de 1 a 10080");
    await expect(setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, textos: { ...DEFAULT_FISCAL_REGRAS.textos, servicos: "   " } }, s.caixaGestao)).rejects.toThrow("O texto \"Serviços\" não pode ficar vazio.");
    await expect(setFiscalRegras({ ...DEFAULT_FISCAL_REGRAS, textos: { ...DEFAULT_FISCAL_REGRAS.textos, servicos: "Feito: {servicos} {cnpj}" } }, s.caixaGestao))
      .rejects.toThrow("No texto \"Serviços\", a variável {cnpj} não existe. Use: {servicos}.");
    expect(await getFiscalRegras()).toEqual(DEFAULT_FISCAL_REGRAS);
  });
});

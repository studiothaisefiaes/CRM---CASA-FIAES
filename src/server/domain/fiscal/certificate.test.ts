import { describe, expect, it } from "vitest";
import { makeTestPfx, TEST_CERT_CNPJ, TEST_PFX_PASSWORD, writeTestPfx } from "../../../../test/fiscal-cert";
import { loadFiscalCert, readPfx } from "./certificate";

describe("readPfx", () => {
  it("lê o CNPJ do CN (padrão ICP-Brasil), a validade, o certificado e a chave em PEM", () => {
    const c = readPfx(makeTestPfx({ notAfter: new Date("2027-03-01T12:00:00Z") }), TEST_PFX_PASSWORD);
    expect(c.cnpj).toBe(TEST_CERT_CNPJ);
    expect(c.notAfter.toISOString()).toBe("2027-03-01T12:00:00.000Z");
    expect(c.certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(c.keyPem).toContain("PRIVATE KEY-----");
  });
  it("PFX com a AC antes do certificado da Casa: escolhe a folha pela chave; a AC vai para a cadeia", () => {
    const c = readPfx(makeTestPfx({ caFirst: true, notAfter: new Date("2027-05-02T12:00:00Z") }), TEST_PFX_PASSWORD);
    expect(c.cnpj).toBe(TEST_CERT_CNPJ);
    expect(c.notAfter.toISOString()).toBe("2027-05-02T12:00:00.000Z");
    expect(c.chainPem).toHaveLength(1);
    expect(c.chainPem[0]).not.toBe(c.certPem);
    expect(readPfx(makeTestPfx(), TEST_PFX_PASSWORD).chainPem).toEqual([]);
  });
  it("sem CNPJ no CN, cnpj fica null", () => {
    expect(readPfx(makeTestPfx({ cn: "FULANO DE TAL" }), TEST_PFX_PASSWORD).cnpj).toBeNull();
  });
  it("senha errada, arquivo que não é .pfx e .pfx sem chave dão frases claras", () => {
    expect(() => readPfx(makeTestPfx(), "errada")).toThrow("Senha do certificado não confere.");
    expect(() => readPfx(Buffer.from("isto não é um pfx"), TEST_PFX_PASSWORD)).toThrow("O arquivo do certificado não é um .pfx válido.");
    expect(() => readPfx(makeTestPfx({ withKey: false }), TEST_PFX_PASSWORD)).toThrow("O certificado não tem a chave privada.");
  });
});

describe("loadFiscalCert", () => {
  it("null quando falta o caminho ou a senha no .env", async () => {
    expect(await loadFiscalCert({})).toBeNull();
    expect(await loadFiscalCert({ FISCAL_CERT_PATH: "/x/casa.pfx" })).toBeNull();
    expect(await loadFiscalCert({ FISCAL_CERT_PASSWORD: "x" })).toBeNull();
  });
  it("lê o arquivo do caminho com a senha do .env", async () => {
    const file = await writeTestPfx();
    const c = await loadFiscalCert({ FISCAL_CERT_PATH: file, FISCAL_CERT_PASSWORD: TEST_PFX_PASSWORD });
    expect(c?.cnpj).toBe(TEST_CERT_CNPJ);
  });
  it("arquivo inexistente e senha errada viram erro com frase", async () => {
    await expect(loadFiscalCert({ FISCAL_CERT_PATH: "/nao/existe/casa.pfx", FISCAL_CERT_PASSWORD: "x" })).rejects.toThrow("O arquivo do certificado não foi encontrado no servidor.");
    const file = await writeTestPfx();
    await expect(loadFiscalCert({ FISCAL_CERT_PATH: file, FISCAL_CERT_PASSWORD: "errada" })).rejects.toThrow("Senha do certificado não confere.");
  });
  it("sem argumento, lê do process.env", async () => {
    const file = await writeTestPfx();
    const old = { p: process.env.FISCAL_CERT_PATH, s: process.env.FISCAL_CERT_PASSWORD };
    process.env.FISCAL_CERT_PATH = file; process.env.FISCAL_CERT_PASSWORD = TEST_PFX_PASSWORD;
    try { expect((await loadFiscalCert())?.cnpj).toBe(TEST_CERT_CNPJ); }
    finally {
      if (old.p === undefined) delete process.env.FISCAL_CERT_PATH; else process.env.FISCAL_CERT_PATH = old.p;
      if (old.s === undefined) delete process.env.FISCAL_CERT_PASSWORD; else process.env.FISCAL_CERT_PASSWORD = old.s;
    }
  });
});

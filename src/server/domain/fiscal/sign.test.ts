import { describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { DEFAULT_FISCAL_EMPRESA } from "@/lib/fiscal-settings";
import { makeTestPfx, TEST_PFX_PASSWORD } from "../../../../test/fiscal-cert";
import { readPfx } from "./certificate";
import { buildCancelEventXml, buildDpsXml } from "./dps-xml";
import { signXml } from "./sign";

const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
const { xml, id } = buildDpsXml({
  draft: { comandaId: "c1", comandaNumber: 7, day: "2026-11-03", tomador: { cpf: null, nome: null }, lines: [{ itemId: "i1", label: "Corte", netCents: 12150, professional: null, partner: null, cTribNac: "060101", nbs: null }], totalCents: 12150, salaoCents: 12150, parceiras: [], discriminacao: "Serviços de beleza: Corte & escova.", parceirasSemCnpj: [], avisos: [] },
  empresa: { ...DEFAULT_FISCAL_EMPRESA, cnpj: "11222333000181", inscricaoMunicipal: "123456", regime: "simples", aliquotaSimplesBp: 600 },
  regras: { informarAliquotaNaDps: false }, environment: "teste", series: 1, number: 42, emittedAt: new Date("2026-11-03T13:00:00Z"),
});

/** Confere a assinatura como o governo faria: só com a chave pública do certificado. */
function verify(signed: string): boolean {
  const sig = signed.match(/<Signature[\s\S]*<\/Signature>/)?.[0];
  if (!sig) return false;
  const v = new SignedXml({ publicCert: cert.certPem });
  v.loadSignature(sig);
  return v.checkSignature(signed);
}

describe("signXml", () => {
  for (const algorithm of ["sha1", "sha256"] as const) {
    it(`Regra do dono: ${algorithm} confere com a chave pública do certificado de teste`, () => {
      const signed = signXml(xml, { elementLocalName: "infDPS", id, cert, algorithm });
      expect(verify(signed)).toBe(true);
      const alg = algorithm === "sha1"
        ? ["http://www.w3.org/2000/09/xmldsig#rsa-sha1", "http://www.w3.org/2000/09/xmldsig#sha1"]
        : ["http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", "http://www.w3.org/2001/04/xmlenc#sha256"];
      expect(signed).toContain(`<SignatureMethod Algorithm="${alg[0]}"/>`);
      expect(signed).toContain(`<DigestMethod Algorithm="${alg[1]}"/>`);
    });
  }
  it("C14N 1.0, transforms enveloped + C14N, Reference #Id e Signature filha de DPS depois de infDPS, com o certificado", () => {
    const signed = signXml(xml, { elementLocalName: "infDPS", id, cert, algorithm: "sha1" });
    expect(signed).toContain(`<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>`);
    expect(signed).toContain(`<Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>`);
    expect(signed).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature><\/DPS>$/);
    const pem = cert.certPem.replace(/-----[^-]+-----|\s/g, "");
    expect(signed).toContain(`<X509Certificate>${pem}</X509Certificate>`);
  });
  it("XML alterado depois de assinado não confere", () => {
    const signed = signXml(xml, { elementLocalName: "infDPS", id, cert, algorithm: "sha256" });
    expect(verify(signed.replace("<vServ>121.50</vServ>", "<vServ>12.15</vServ>"))).toBe(false);
  });
  it("assina o pedido de cancelamento (infPedReg)", () => {
    const ev = buildCancelEventXml({ accessKey: "3".repeat(50), cnpj: "11222333000181", environment: "teste", reason: "Erro na emissão da nota", code: "1", emittedAt: new Date() });
    const signed = signXml(ev.xml, { elementLocalName: "infPedReg", id: ev.id, cert, algorithm: "sha1" });
    expect(verify(signed)).toBe(true);
    expect(signed).toMatch(/<\/infPedReg><Signature [\s\S]*<\/Signature><\/pedRegEvento>$/);
  });
  it("recusa Id ou elemento fora do formato (nada de XPath montado com texto solto)", () => {
    expect(() => signXml(xml, { elementLocalName: "infDPS", id: "x' or '1'='1", cert, algorithm: "sha1" })).toThrow();
    expect(() => signXml(xml, { elementLocalName: "inf DPS", id, cert, algorithm: "sha1" })).toThrow();
    expect(() => signXml(xml, { elementLocalName: "infDPS", id: "DPS1", cert, algorithm: "sha1" })).toThrow("Elemento infDPS com Id DPS1 não encontrado no XML.");
  });
});

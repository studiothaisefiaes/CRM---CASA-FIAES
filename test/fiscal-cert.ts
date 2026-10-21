import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

/**
 * Certificado A1 de mentira, SÓ para os testes da nota fiscal: PFX autoassinado com o CNPJ fictício no CN, como o ICP-Brasil faz
 * ("RAZÃO SOCIAL:CNPJ"). Nunca vai para o repositório nem para a Sefin: os arquivos ficam no os.tmpdir().
 */
export const TEST_CERT_CNPJ = "11222333000181";
export const TEST_PFX_PASSWORD = "senha-de-teste";

type Pair = { publicKey: string; privateKey: string };
const pairs: { leaf?: Pair; ca?: Pair } = {};
const gen = (): Pair => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const keys = (k: "leaf" | "ca") => (pairs[k] ??= gen());

/** Certificado da "AC" de teste (outra chave, outro número no CN, validade mais longa) para montar a cadeia. */
function testCa() {
  const { publicKey, privateKey } = keys("ca");
  const key = forge.pki.privateKeyFromPem(privateKey);
  const ca = forge.pki.createCertificate();
  ca.publicKey = forge.pki.publicKeyFromPem(publicKey);
  ca.serialNumber = "02";
  ca.validity.notBefore = new Date("2025-01-01T00:00:00Z");
  ca.validity.notAfter = new Date("2035-01-01T00:00:00Z");
  const attrs = [{ name: "commonName", value: "AC TESTE RFB:00000000000191" }, { name: "countryName", value: "BR" }, { name: "organizationName", value: "ICP-Brasil" }];
  ca.setSubject(attrs);
  ca.setIssuer(attrs);
  ca.setExtensions([{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true }]);
  ca.sign(key, forge.md.sha256.create());
  return { ca, key, attrs };
}

/** `caFirst`: o PFX traz a AC ANTES do certificado da Casa (acontece em .pfx exportado do Windows); quem lê precisa achar a folha pela chave. */
export function makeTestPfx(o: { password?: string; notAfter?: Date; cn?: string; withKey?: boolean; caFirst?: boolean } = {}): Buffer {
  const { publicKey, privateKey } = keys("leaf");
  const pub = forge.pki.publicKeyFromPem(publicKey), key = forge.pki.privateKeyFromPem(privateKey);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = o.notAfter ?? new Date("2027-10-18T15:00:00Z");
  const attrs = [{ name: "commonName", value: o.cn ?? `CASA FIAES LTDA:${TEST_CERT_CNPJ}` }, { name: "countryName", value: "BR" }, { name: "organizationName", value: "ICP-Brasil" }];
  cert.setSubject(attrs);
  cert.setExtensions([{ name: "keyUsage", digitalSignature: true, nonRepudiation: true, keyEncipherment: true }]);
  let certs = [cert];
  if (o.caFirst) {
    const { ca, key: caKey, attrs: caAttrs } = testCa();
    cert.setIssuer(caAttrs);
    cert.sign(caKey, forge.md.sha256.create());
    certs = [ca, cert];
  } else {
    cert.setIssuer(attrs);
    cert.sign(key, forge.md.sha256.create());
  }
  const asn1 = forge.pkcs12.toPkcs12Asn1(o.withKey === false ? null : key, certs, o.password ?? TEST_PFX_PASSWORD, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

/** Grava o PFX de teste numa pasta temporária nova e devolve o caminho. */
export async function writeTestPfx(o: Parameters<typeof makeTestPfx>[0] = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crm-fiscal-cert-"));
  const file = path.join(dir, "casa.pfx");
  await writeFile(file, makeTestPfx(o));
  return file;
}

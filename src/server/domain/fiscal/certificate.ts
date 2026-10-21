import { readFile } from "node:fs/promises";
import forge from "node-forge";
import { UserFacingError } from "../errors";

/**
 * Certificado digital A1 (e-CNPJ, .pfx) da Casa para assinar a NFS-e e falar com a Sefin Nacional por mTLS.
 * Porta `lib/fiscal/certificado.ts` do Norte Vendas, mas lendo do .env do servidor (FISCAL_CERT_PATH + FISCAL_CERT_PASSWORD),
 * nunca do banco nem do repositório. O PEM da chave só vive em memória.
 */
export type FiscalCert = {
  certPem: string; keyPem: string; cnpj: string | null; notAfter: Date;
  /** Os outros certificados do .pfx (AC intermediária e raiz), em PEM: vão junto no mTLS para o servidor montar a cadeia. */
  chainPem: string[];
};

/** Extrai o certificado "folha" e a chave privada do .pfx (o Node não separa PKCS#12 em cert + key sozinho; por isso node-forge). */
export function readPfx(pfx: Buffer, password: string): FiscalCert {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (e) {
    // O node-forge avisa a senha errada pela verificação do MAC ("Invalid password?"); o resto é arquivo que não é PKCS#12.
    if (e instanceof Error && /password|MAC/i.test(e.message)) throw new UserFacingError("Senha do certificado não confere.");
    throw new UserFacingError("O arquivo do certificado não é um .pfx válido.");
  }
  const certBags = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).filter((b) => b.cert);
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
    ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!certBags.length) throw new UserFacingError("O arquivo do certificado não é um .pfx válido.");
  if (!keyBag?.key) throw new UserFacingError("O certificado não tem a chave privada.");
  // O .pfx pode trazer a cadeia em qualquer ordem: a folha é o certificado cuja chave pública é a da chave privada (módulo RSA igual);
  // sem isso, o que tem o mesmo localKeyId da chave; por último, o primeiro.
  const key = keyBag.key as forge.pki.rsa.PrivateKey;
  const sameKey = (b: forge.pkcs12.Bag) => { const pub = b.cert!.publicKey as forge.pki.rsa.PublicKey; return !!pub?.n && !!key.n && pub.n.equals(key.n); };
  const keyId = keyBag.attributes?.localKeyId?.[0];
  const leafBag = certBags.find(sameKey) ?? (keyId ? certBags.find((b) => b.attributes?.localKeyId?.[0] === keyId) : undefined) ?? certBags[0];
  const cert = leafBag.cert!;
  // ICP-Brasil grava o e-CNPJ no CN como "RAZÃO SOCIAL:CNPJ".
  const cn = cert.subject.getField("CN")?.value as string | undefined;
  const cnpj = cn?.match(/(\d{14})(?!.*\d{14})/)?.[1] ?? null;
  const chainPem = certBags.filter((b) => b !== leafBag).map((b) => forge.pki.certificateToPem(b.cert!));
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keyBag.key), cnpj, notAfter: cert.validity.notAfter, chainPem };
}

/** Lê o A1 do caminho e da senha do .env. null quando falta um dos dois; arquivo sumido ou senha errada viram erro com frase. */
export async function loadFiscalCert(src: Record<string, string | undefined> = process.env): Promise<FiscalCert | null> {
  const file = src.FISCAL_CERT_PATH, password = src.FISCAL_CERT_PASSWORD;
  if (!file || !password) return null;
  let pfx: Buffer;
  try { pfx = await readFile(file); }
  catch { throw new UserFacingError("O arquivo do certificado não foi encontrado no servidor."); }
  return readPfx(pfx, password);
}

/** O A1 do servidor, ou null quando falta, o arquivo sumiu ou a senha não confere (para quem só precisa saber se dá para usar). */
export async function loadFiscalCertOrNull(): Promise<FiscalCert | null> {
  try { return await loadFiscalCert(); }
  catch (e) { if (e instanceof UserFacingError) return null; throw e; }
}

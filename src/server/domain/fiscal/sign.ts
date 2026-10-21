import { SignedXml } from "xml-crypto";
import type { FiscalCert } from "./certificate";

/**
 * Assinatura XMLDSig envelopada da DPS (`infDPS`) e do pedido de evento (`infPedReg`). Porta `lib/fiscal/assinatura.ts` do Norte Vendas,
 * com o elemento como parâmetro.
 *
 * Algoritmo NÃO CONFIRMADO no manual (manual 2022: SHA-1; guia NFS-e Via 2025: SHA-256) — configurável em Configurações › Nota fiscal
 * (`fiscal_regras.assinaturaNfse`). Conferência de 18/10/2026: teste os dois na Produção Restrita; a recusa esperada é E0714.
 *
 * Estrutura CONFIRMADA no XSD v1.01 + Manual Integrado em 18/10/2026: C14N 1.0, transforms enveloped + C14N, `Reference URI="#Id"`,
 * `Signature` filha do elemento raiz logo depois de `infDPS`/`infPedReg`, com o certificado em `KeyInfo/X509Data`.
 */
export const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const SIGN_ALGORITHMS = {
  sha1: { signature: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", digest: "http://www.w3.org/2000/09/xmldsig#sha1" },
  sha256: { signature: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", digest: "http://www.w3.org/2001/04/xmlenc#sha256" },
} as const;

export function signXml(xml: string, o: { elementLocalName: string; id: string; cert: FiscalCert; algorithm: "sha1" | "sha256" }): string {
  // Nome e Id entram no XPath: só letras e números, nada de texto solto.
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(o.elementLocalName)) throw new Error("Nome de elemento inválido para assinar.");
  if (!/^[A-Za-z0-9]+$/.test(o.id)) throw new Error("Id inválido para assinar.");
  const alg = SIGN_ALGORITHMS[o.algorithm];
  if (!alg) throw new Error("Algoritmo de assinatura inválido.");
  if (!xml.includes(`<${o.elementLocalName} Id="${o.id}"`)) throw new Error(`Elemento ${o.elementLocalName} com Id ${o.id} não encontrado no XML.`);
  const xpath = `//*[local-name(.)='${o.elementLocalName}' and @Id='${o.id}']`;
  const sig = new SignedXml({ privateKey: o.cert.keyPem, publicCert: o.cert.certPem, canonicalizationAlgorithm: C14N, signatureAlgorithm: alg.signature });
  sig.addReference({ xpath, transforms: [ENVELOPED, C14N], digestAlgorithm: alg.digest, uri: `#${o.id}` });
  sig.computeSignature(xml, { location: { reference: xpath, action: "after" } });
  return sig.getSignedXml();
}

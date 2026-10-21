import { createHash } from "node:crypto";

/**
 * QR Code da NFC-e (porte de `lib/fiscal/qrcode.ts` do Norte Vendas). Versão 2, emissão online — CONFIRMADO em 18/10/2026 no Manual do
 * DANFE-NFC-e e QR Code v5.1 (§14 da conferência):
 *   p = <chave>|2|<tpAmb>|<idCSC sem zeros à esquerda>|<hash>
 *   hash = SHA-1 em hexadecimal de "<chave>|2|<tpAmb>|<idCSC>" + CSC (sem separador antes do CSC)
 * A SEFAZ confere esse hash de verdade: CSC errado devolve cStat=464 "Código de Hash no QR-Code difere do calculado" (Norte Vendas,
 * 04/08/2026). O CSC e o ID do CSC moram só no .env do servidor (NFCE_CSC, NFCE_CSC_ID); o CSC nunca entra no XML, só no hash.
 * Contingência offline (outra fórmula, com dia, vNF e digVal) fica fora desta fase.
 */
export function montarQrCode(d: { chave: string; tpAmb: "1" | "2"; idCsc: string; csc: string; urlQrCode: string; urlChave: string }): { qrCode: string; supl: string } {
  if (!/^[0-9]{44}$/.test(d.chave)) throw new Error("Chave de acesso inválida para o QR Code.");
  if (!/^[0-9]{1,6}$/.test(d.idCsc)) throw new Error("ID do CSC inválido.");
  if (!d.csc) throw new Error("CSC vazio.");
  const params = `${d.chave}|2|${d.tpAmb}|${String(Number(d.idCsc))}`;
  const hash = createHash("sha1").update(params + d.csc, "utf8").digest("hex").toUpperCase();
  const qrCode = `${d.urlQrCode}?p=${params}|${hash}`;
  return { qrCode, supl: `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${d.urlChave}</urlChave></infNFeSupl>` };
}

/**
 * O infNFeSupl entra ENTRE infNFe e Signature (ordem do schema). Inserir depois de assinar não invalida nada: o digest cobre só o
 * subtree de infNFe.
 */
export function inserirSupl(xmlAssinado: string, supl: string): string {
  const i = xmlAssinado.indexOf("<Signature");
  if (i < 0) throw new Error("XML sem assinatura: o QR Code entra depois de assinar.");
  return xmlAssinado.slice(0, i) + supl + xmlAssinado.slice(i);
}

/** O link do QR Code gravado na NFC-e (para "Consultar pelo QR Code"). */
export const qrCodeOf = (xml: string | null) => xml?.match(/<qrCode><!\[CDATA\[([^\]]+)\]\]><\/qrCode>/)?.[1] ?? null;

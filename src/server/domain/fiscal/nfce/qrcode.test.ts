import { describe, expect, it } from "vitest";
import { inserirSupl, montarQrCode } from "./qrcode";
import { NFCE_CONSULTA_BA } from "./soap";

const CHAVE = "29260839912717000145650010000000011732405968";
/** CSC FICTÍCIO, só deste teste (o de verdade fica no .env do servidor, nunca no repositório). */
const CSC_DE_TESTE = "CSC0TESTE0CASA0FIAES0000000000000000";

describe("QR Code da NFC-e (versão 2, emissão online)", () => {
  it("hash SHA-1 de chave|2|tpAmb|idCSC + CSC, em hexadecimal maiúsculo, com o idCSC sem zeros à esquerda", () => {
    const r = montarQrCode({ chave: CHAVE, tpAmb: "2", idCsc: "000001", csc: CSC_DE_TESTE, ...NFCE_CONSULTA_BA.teste });
    // Valor calculado à parte (node:crypto) para estes dados fictícios: sha1("…|2|2|1" + CSC).
    expect(r.qrCode).toBe(`http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=${CHAVE}|2|2|1|B0C9F22C0CF7E696BCB378B37126B0B902DBD5B1`);
    expect(r.supl).toBe(`<infNFeSupl><qrCode><![CDATA[${r.qrCode}]]></qrCode><urlChave>http://hinternet.sefaz.ba.gov.br/nfce/consulta</urlChave></infNFeSupl>`);
  });
  it("outro CSC dá outro hash; produção usa os endereços de produção", () => {
    const a = montarQrCode({ chave: CHAVE, tpAmb: "1", idCsc: "1", csc: CSC_DE_TESTE, ...NFCE_CONSULTA_BA.producao });
    const b = montarQrCode({ chave: CHAVE, tpAmb: "1", idCsc: "1", csc: "OUTRO-CSC", ...NFCE_CONSULTA_BA.producao });
    expect(a.qrCode.startsWith(`http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=${CHAVE}|2|1|1|`)).toBe(true);
    expect(a.qrCode).not.toBe(b.qrCode);
    expect(a.supl).toContain("<urlChave>http://www.sefaz.ba.gov.br/nfce/consulta</urlChave>");
  });
  it("o grupo infNFeSupl entra entre infNFe e Signature", () => {
    expect(inserirSupl("<NFe><infNFe Id=\"x\"></infNFe><Signature xmlns=\"s\"></Signature></NFe>", "<infNFeSupl/>"))
      .toBe("<NFe><infNFe Id=\"x\"></infNFe><infNFeSupl/><Signature xmlns=\"s\"></Signature></NFe>");
    expect(() => inserirSupl("<NFe></NFe>", "<infNFeSupl/>")).toThrow();
  });
});

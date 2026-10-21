import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { EXPORT_MAX_FILES, EXPORT_TEXT_MAX_BYTES, exportTitle, parseWhatsappExport, readExportFile } from "./whatsapp-export";

const L = "‎";
const ANDROID = [
  "02/03/2025 09:00 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta. Somente as pessoas que fazem parte da conversa podem ler.",
  "02/03/2025 09:01 - Cliente Teste: Oi, bom dia! 😊",
  "Queria saber o preço",
  "da progressiva",
  "02/03/2025 09:05 - Casa Fiaes: Bom dia! A progressiva sai R$ 300 <Mensagem editada>",
  "02/03/2025 09:06 - Cliente Teste: <Mídia oculta>",
  "02/03/2025 09:07 - Cliente Teste: IMG-20250302-WA0001.jpg (arquivo anexado)",
  "olha esse cabelo",
  "02/03/2025 09:08 - Cliente Teste: Esta mensagem foi apagada",
  "02/03/2025 09:09 - Cliente Teste mudou o número de telefone.",
  "02/03/25 21:40 - Casa Fiaes: PTT-20250302-WA0002.opus (arquivo anexado)",
].join("\n");
const IPHONE = [
  `[02/03/2025, 09:00:00] Cliente Teste: ${L}As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.`,
  `${L}[02/03/2025, 09:01:12] Cliente Teste: Oi`,
  "tudo bem?",
  `${L}[02/03/2025, 09:02:30] Casa Fiaes: ${L}imagem ocultada`,
  `${L}[02/03/2025, 09:03:00] Casa Fiaes: ${L}<anexado: 00000003-PHOTO-2025-03-02-09-03-00.jpg>`,
  `[02/03/2025, 09:04:00] Casa Fiaes: ${L}Tabela.pdf • ${L}2 páginas ${L}<anexado: 00000004-Tabela.pdf>`,
  `[02/03/2025, 09:05:00] Cliente Teste: ${L}Esta mensagem foi apagada.`,
  `[02/03/2025, 09:06:00] Cliente Teste: ${L}Ligação de voz perdida`,
].join("\r\n");

describe("ler o Exportar conversa do WhatsApp", () => {
  it("Android: várias linhas, editada, mídia oculta e anexada, sistema e apagada ficam de fora, hora de Salvador", () => {
    const p = parseWhatsappExport(ANDROID);
    expect(p.senders).toEqual(["Cliente Teste", "Casa Fiaes"]);
    expect(p.group).toBe(false);
    expect(p.system).toBe(2);
    expect(p.deleted).toBe(1);
    expect(p.messages.map((m) => [m.sender, m.text, m.media?.kind ?? null, m.media?.file ?? null])).toEqual([
      ["Cliente Teste", "Oi, bom dia! 😊\nQueria saber o preço\nda progressiva", null, null],
      ["Casa Fiaes", "Bom dia! A progressiva sai R$ 300", null, null],
      ["Cliente Teste", "", "other", null],
      ["Cliente Teste", "olha esse cabelo", "image", "IMG-20250302-WA0001.jpg"],
      ["Casa Fiaes", "", "audio", "PTT-20250302-WA0002.opus"],
    ]);
    expect(p.messages[1].edited).toBe(true);
    expect(p.messages[0].at.toISOString()).toBe("2025-03-02T12:01:00.000Z"); // 09:01 em Salvador (UTC-3)
    expect(p.messages[4].at.toISOString()).toBe("2025-03-03T00:40:00.000Z"); // ano com 2 dígitos, virada do dia em UTC
  });

  it("iPhone: colchetes, segundos, marcas invisíveis, anexos, documento com páginas, ligação e criptografia ignoradas", () => {
    const p = parseWhatsappExport(IPHONE);
    expect(p.senders).toEqual(["Cliente Teste", "Casa Fiaes"]);
    expect(p.system).toBe(2);
    expect(p.deleted).toBe(1);
    expect(p.messages.map((m) => [m.sender, m.text, m.media?.kind ?? null, m.media?.file ?? null])).toEqual([
      ["Cliente Teste", "Oi\ntudo bem?", null, null],
      ["Casa Fiaes", "", "image", null],
      ["Casa Fiaes", "", "image", "00000003-PHOTO-2025-03-02-09-03-00.jpg"],
      ["Casa Fiaes", "Tabela.pdf", "document", "00000004-Tabela.pdf"],
    ]);
    expect(p.messages[0].at.toISOString()).toBe("2025-03-02T12:01:12.000Z");
  });

  it("grupo: mais de duas pessoas falando", () => {
    const p = parseWhatsappExport("01/01/2025 10:00 - Ana: oi\n01/01/2025 10:01 - Bia: oi\n01/01/2025 10:02 - Casa Fiaes: olá");
    expect(p.group).toBe(true);
  });

  it("telefone e nome pelo nome do arquivo", () => {
    expect(exportTitle("Conversa do WhatsApp com +55 71 99999-0011.zip")).toEqual({ label: "+55 71 99999-0011", phone: "+5571999990011" });
    expect(exportTitle("WhatsApp Chat - Cliente Teste.zip")).toEqual({ label: "Cliente Teste", phone: null });
    expect(exportTitle("_chat.txt")).toEqual({ label: null, phone: null });
  });

  it(".zip: acha o _chat.txt e lista as mídias", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", IPHONE);
    zip.file("00000003-PHOTO-2025-03-02-09-03-00.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const f = await readExportFile("Conversa.zip", await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    expect(f.chat).toContain("tudo bem?");
    expect([...f.media.keys()]).toEqual(["00000003-PHOTO-2025-03-02-09-03-00.jpg"]);
    expect(f.media.get("00000003-PHOTO-2025-03-02-09-03-00.jpg")!.size).toBe(7);
  });
});

/**
 * Revisão de segurança 17/10 (M5): bomba de zip. O tamanho que o .zip declara pode ser mentira; o limite vale para os bytes
 * de verdade, contados enquanto descompacta, e o número de arquivos dentro do .zip tem teto.
 */
describe(".zip: limites reais (bomba de zip)", () => {
  /** Troca o tamanho descompactado declarado (cabeçalho local e diretório central) das entradas que terminam em `suffix` por `size`. */
  const lieAboutSize = (zip: Uint8Array, size: number, suffix = "") => {
    const b = Buffer.from(zip);
    for (let i = 0; i < b.length - 46; i++) {
      const sig = b.readUInt32LE(i);
      if (sig === 0x04034b50 && b.toString("utf8", i + 30, i + 30 + b.readUInt16LE(i + 26)).endsWith(suffix)) b.writeUInt32LE(size, i + 22);
      else if (sig === 0x02014b50 && b.toString("utf8", i + 46, i + 46 + b.readUInt16LE(i + 28)).endsWith(suffix)) b.writeUInt32LE(size, i + 24);
    }
    return new Uint8Array(b);
  };

  it("_chat.txt que declara 100 bytes mas descompacta 21 MB: recusa sem montar o texto", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", "a".repeat(EXPORT_TEXT_MAX_BYTES + 1024 * 1024));
    const bytes = lieAboutSize(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), 100);
    await expect(readExportFile("Conversa.zip", bytes)).rejects.toThrow("O texto da conversa passa de 20 MB.");
  });

  it("mídia que declara menos do que tem: a leitura para no tamanho declarado e recusa", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", IPHONE);
    zip.file("00000003-PHOTO-2025-03-02-09-03-00.jpg", new Uint8Array(512 * 1024));
    const f = await readExportFile("Conversa.zip", lieAboutSize(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), 10, ".jpg"));
    expect(f.media.get("00000003-PHOTO-2025-03-02-09-03-00.jpg")!.size).toBe(10);
    await expect(f.media.get("00000003-PHOTO-2025-03-02-09-03-00.jpg")!.read()).rejects.toThrow("corrompid");
  });

  it("arquivos demais dentro do .zip: recusa", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", IPHONE);
    for (let i = 0; i <= EXPORT_MAX_FILES; i++) zip.file(`m/${i}.jpg`, "x");
    await expect(readExportFile("Conversa.zip", await zip.generateAsync({ type: "uint8array", compression: "STORE" }))).rejects.toThrow("arquivos demais");
  });

  it("diretório central com milhares de entradas repetidas e o fim do .zip dizendo 2: recusa antes de abrir", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", IPHONE);
    zip.file("m.jpg", "x");
    const b = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
    const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cdOffset = b.readUInt32LE(eocd + 16), cdSize = b.readUInt32LE(eocd + 12);
    const cd = b.subarray(cdOffset, cdOffset + cdSize);
    const second = cd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), 4); // entrada do m.jpg
    const repeated = Buffer.concat(Array.from({ length: EXPORT_MAX_FILES + 10 }, () => cd.subarray(second)));
    const newCd = Buffer.concat([cd.subarray(0, second), repeated]);
    const tail = Buffer.from(b.subarray(eocd));
    tail.writeUInt32LE(newCd.length, 12); // tamanho do diretório central; a contagem (8 e 10) continua dizendo 2
    const forged = Buffer.concat([b.subarray(0, cdOffset), newCd, tail]);
    await expect(readExportFile("Conversa.zip", new Uint8Array(forged))).rejects.toThrow("arquivos demais");
  });

  it("o .zip normal continua abrindo, com o texto e a mídia inteiros", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", IPHONE);
    zip.file("00000003-PHOTO-2025-03-02-09-03-00.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const f = await readExportFile("Conversa.zip", await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    expect(f.chat).toBe(IPHONE);
    expect([...(await f.media.get("00000003-PHOTO-2025-03-02-09-03-00.jpg")!.read())]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  });
});

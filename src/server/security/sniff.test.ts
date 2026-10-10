import { describe, it, expect } from "vitest";
import { sniffMime, mediaHeaders } from "./sniff";
const b = (...x: number[]) => new Uint8Array(x);
const t = (s: string) => new TextEncoder().encode(s);
describe("sniffMime", () => {
  it("reconhece jpeg/png/pdf/ogg", () => {
    expect(sniffMime(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMime(t("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(t("OggS\0"))).toBe("audio/ogg");
  });
  it("reconhece gif/webp/mp3/m4a/mp4/webm", () => {
    expect(sniffMime(t("GIF89a"))).toBe("image/gif");
    expect(sniffMime(t("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(t("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffMime(t("ID3\x04\0"))).toBe("audio/mpeg");
    expect(sniffMime(b(0xff, 0xfb, 0x90, 0x00))).toBe("audio/mpeg");
    expect(sniffMime(t("\0\0\0\x20ftypM4A \0\0\0\0"))).toBe("audio/mp4");
    expect(sniffMime(t("\0\0\0\x18ftypmp42\0\0\0\0"))).toBe("video/mp4");
    expect(sniffMime(b(0x1a, 0x45, 0xdf, 0xa3, 0x01))).toBe("video/webm");
  });
  it("html e svg nunca são aceitos, mesmo começando com espaço", () => {
    expect(sniffMime(t("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(t("  <svg onload=alert(1)>"))).toBeNull();
    expect(sniffMime(t("<?xml version=\"1.0\"?><svg/>"))).toBeNull();
    expect(sniffMime(b())).toBeNull();
    expect(sniffMime(b(0xff))).toBeNull();
  });
  it("BOM de UTF-16/UTF-8 antes de <html> não passa por MP3", () => {
    const u16le = (x: string) => new Uint8Array([0xff, 0xfe, ...[...x].flatMap((c) => [c.charCodeAt(0), 0])]);
    const u16be = (x: string) => new Uint8Array([0xfe, 0xff, ...[...x].flatMap((c) => [0, c.charCodeAt(0)])]);
    expect(sniffMime(u16le("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(u16be("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(new Uint8Array([0xef, 0xbb, 0xbf, ...t("<html>")]))).toBeNull();
    expect(sniffMime(b(0xff, 0xff, 0x3c, 0x00))).toBeNull();
    // MPEG-2 Layer III continua aceito; AAC (ADTS, layer 00) não é MP3.
    expect(sniffMime(b(0xff, 0xf3, 0x40, 0x00))).toBe("audio/mpeg");
    expect(sniffMime(b(0xff, 0xf1, 0x50, 0x80))).toBeNull();
  });
});
describe("mediaHeaders", () => {
  it("tipo seguro abre inline com nosniff e sandbox", () => {
    const h = mediaHeaders("image/jpeg", "foto.jpg");
    expect(h["content-type"]).toBe("image/jpeg");
    expect(h["content-disposition"]).toMatch(/^inline/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toBe("sandbox");
    expect(h["cache-control"]).toBe("private, max-age=31536000, immutable");
  });
  it("áudio e vídeo também abrem inline", () => {
    expect(mediaHeaders("audio/ogg", "a.ogg")["content-disposition"]).toMatch(/^inline/);
    expect(mediaHeaders("video/mp4", "v.mp4")["content-disposition"]).toMatch(/^inline/);
  });
  it("pdf vai como download (sandbox bloquearia o visualizador do Chrome)", () => {
    const h = mediaHeaders("application/pdf", "orcamento.pdf");
    expect(h["content-type"]).toBe("application/pdf");
    expect(h["content-disposition"]).toBe('attachment; filename="orcamento.pdf"');
    expect(h["content-security-policy"]).toBe("sandbox");
  });
  it("desconhecido vira download octet-stream com nome sanitizado", () => {
    const h = mediaHeaders(null, '../"x".html');
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(h["content-disposition"]).toBe('attachment; filename="x.html"');
    expect(h["x-content-type-options"]).toBe("nosniff");
  });
  it("nome sem a extensão do tipo detectado ganha a extensão", () => {
    expect(mediaHeaders("application/pdf", "segue o orcamento")["content-disposition"]).toBe('attachment; filename="segue o orcamento.pdf"');
    expect(mediaHeaders("application/pdf", "Orcamento.PDF")["content-disposition"]).toBe('attachment; filename="Orcamento.PDF"');
    expect(mediaHeaders("image/jpeg", "foto.jpeg")["content-disposition"]).toBe('inline; filename="foto.jpeg"');
    expect(mediaHeaders("application/pdf", "")["content-disposition"]).toBe('attachment; filename="arquivo.pdf"');
    // corte em 80 preserva a extensão
    expect(mediaHeaders("application/pdf", "b".repeat(200))["content-disposition"]).toBe(`attachment; filename="${"b".repeat(76)}.pdf"`);
    expect(mediaHeaders("application/pdf", "c".repeat(200) + ".pdf")["content-disposition"]).toBe(`attachment; filename="${"c".repeat(76)}.pdf"`);
  });
  it("nome longo é cortado em 80 caracteres e acento não quebra o cabeçalho", () => {
    const longo = mediaHeaders(null, "a".repeat(200) + ".pdf")["content-disposition"];
    expect(longo).toBe(`attachment; filename="${"a".repeat(80)}"`);
    const acento = mediaHeaders("application/pdf", "orçamento 💇.pdf")["content-disposition"];
    expect(acento).toBe(`attachment; filename="or_amento _.pdf"; filename*=UTF-8''${encodeURIComponent("orçamento 💇.pdf")}`);
    expect(() => new Headers(mediaHeaders("application/pdf", "orçamento 💇.pdf\r\nx: y"))).not.toThrow();
    expect(mediaHeaders(null, "")["content-disposition"]).toBe('attachment; filename="arquivo"');
  });
});

describe("sniffMime: mp4 de áudio gravado no navegador", () => {
  const box = (type: string, handler: string) => `\0\0\0\x21${type}\0\0\0\0\0\0\0\0${handler}\0\0\0\0`;
  it("ftyp genérico com handler soun é áudio; com vide é vídeo", () => {
    expect(sniffMime(t("\0\0\0\x18ftypisom\0\0\0\0isom" + box("hdlr", "soun")))).toBe("audio/mp4");
    expect(sniffMime(t("\0\0\0\x18ftypiso5\0\0\0\0iso5" + box("hdlr", "soun")))).toBe("audio/mp4");
    expect(sniffMime(t("\0\0\0\x18ftypmp42\0\0\0\0mp42" + box("hdlr", "vide") + box("hdlr", "soun")))).toBe("video/mp4");
    expect(sniffMime(t("\0\0\0\x18ftypisom\0\0\0\0isom" + box("hdlr", "vide")))).toBe("video/mp4");
  });
  it("M4B também é áudio", () => { expect(sniffMime(t("\0\0\0\x20ftypM4B \0\0\0\0"))).toBe("audio/mp4"); });
});

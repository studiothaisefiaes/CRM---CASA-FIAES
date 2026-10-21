import { describe, expect, it } from "vitest";
import { isVersionSkewError } from "./version-skew";

describe("erro de versão (20/10, Cati: 'Failed to find Server Action … older or newer deployment' depois de subir versão)", () => {
  it("reconhece a ação que o servidor novo não tem (no navegador e no servidor)", () => {
    const naTela = Object.assign(new Error('Server Action "40c0ffee" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'), { name: "UnrecognizedActionError" });
    expect(isVersionSkewError(naTela)).toBe(true);
    expect(isVersionSkewError(new Error('Failed to find Server Action "40c0ffee". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isVersionSkewError({ name: "UnrecognizedActionError", message: "" })).toBe(true);
  });

  it("reconhece o pedaço de tela da versão antiga que sumiu do servidor", () => {
    expect(isVersionSkewError(Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isVersionSkewError(new Error("Failed to load chunk /_next/static/chunks/abc.js"))).toBe(true);
  });

  it("os outros erros não são de versão", () => {
    expect(isVersionSkewError(new Error("Failed to fetch"))).toBe(false);
    expect(isVersionSkewError(new Error("Não deu para enviar"))).toBe(false);
    expect(isVersionSkewError(null)).toBe(false);
    expect(isVersionSkewError("texto")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { resolvedLabel } from "./resolved";

const NOW = Date.parse("2026-10-20T17:30:00Z"); // 14:30 em Salvador
describe("situação “resolvida”", () => {
  it("mostra quem resolveu e quando, enquanto a cliente não escreve de novo", () => {
    expect(resolvedLabel({ resolvedAt: "2026-10-20T17:02:00Z", lastInboundAt: "2026-10-20T16:00:00Z", resolvedByName: "Sara Lima" }, NOW)).toBe("Resolvida sem resposta por Sara · 14:02");
  });
  it("a cliente escreveu depois: some", () => {
    expect(resolvedLabel({ resolvedAt: "2026-10-20T17:02:00Z", lastInboundAt: "2026-10-20T17:10:00Z", resolvedByName: "Sara" }, NOW)).toBeNull();
  });
  it("nunca resolvida: nada", () => {
    expect(resolvedLabel({ resolvedAt: null, lastInboundAt: null, resolvedByName: null }, NOW)).toBeNull();
  });
});

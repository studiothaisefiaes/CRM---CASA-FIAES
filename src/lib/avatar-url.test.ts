import { expect, it } from "vitest";
import { avatarUrl, avatarVersion } from "./avatar-url";

it("URL da foto: miniatura por padrão, versão quando há, original com full", () => {
  expect(avatarUrl("c1")).toBe("/api/avatar/c1");
  expect(avatarUrl("c1", "1760000000")).toBe("/api/avatar/c1?v=1760000000");
  expect(avatarUrl("c1", null, true)).toBe("/api/avatar/c1?full=1");
  expect(avatarUrl("c1", "17 6", true)).toBe("/api/avatar/c1?v=17%206&full=1");
});

it("versão = segundos inteiros de quando o worker revisou a foto (o mesmo avatarV da Fila); sem data, '0'", () => {
  expect(avatarVersion(new Date("2026-10-17T12:00:00.999Z"))).toBe(String(Date.UTC(2026, 9, 17, 12) / 1000));
  expect(avatarVersion("2026-10-17T12:00:00.500Z")).toBe(String(Date.UTC(2026, 9, 17, 12) / 1000));
  expect(avatarVersion(null)).toBe("0");
  expect(avatarVersion(undefined)).toBe("0");
});

import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("aceita UUID", () => { expect(isUuid("0c9f1a52-7b3e-4d11-8a6f-123456789abc")).toBe(true); expect(isUuid("0C9F1A52-7B3E-4D11-8A6F-123456789ABC")).toBe(true); });
  it("recusa o que só parece UUID", () => {
    for (const v of ["-".repeat(36), "a".repeat(36), "0c9f1a52-7b3e-4d11-8a6f-123456789ab", "0c9f1a52-7b3e-4d11-8a6f-123456789abcd", "../etc/passwd", "", null, undefined, 42]) expect(isUuid(v)).toBe(false);
  });
});

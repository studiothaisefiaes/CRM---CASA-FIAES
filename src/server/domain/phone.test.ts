import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["71 99981-2244", "+5571999812244"],
    ["(71) 99981-2244", "+5571999812244"],
    ["+55 71 99981-2244", "+5571999812244"],
    ["5571999812244@s.whatsapp.net", "+5571999812244"],
    ["557199812244@s.whatsapp.net", "+5571999812244"], // sem o 9 (formato antigo do WhatsApp)
    ["99981-2244", "+5571999812244"], // local, DDD padrão 71
    ["9981-2244", "+5571999812244"], // celular antigo de 8 dígitos
    ["11 3456-7890", "+551134567890"], // fixo SP
    ["0055 71 99981 2244", "+5571999812244"],
  ])("%s → %s", (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each([["120363025@g.us"], ["status@broadcast"], [""], ["abc"], ["123"], [null]])("rejeita %s", (raw) =>
    expect(normalizePhone(raw as string | null)).toBeNull());

  it("formata para exibição", () => expect(formatPhone("+5571999812244")).toBe("(71) 99981-2244"));
});

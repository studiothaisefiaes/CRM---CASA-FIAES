import { expect, it } from "vitest";
import { isConversationPath, leadHref } from "./lead-href";

it("aponta para o lead aberto na Fila", () => {
  expect(leadHref("abc")).toBe("/atendimento?lead=abc");
  expect(leadHref(null)).toBe("/atendimento");
});

it("reconhece a conversa em tela cheia, e só ela", () => {
  const id = "0b9c6a52-1f7e-4c1a-9d3e-5a8f2c4e7b10";
  expect(isConversationPath(`/atendimento/${id}`)).toBe(true);
  expect(isConversationPath(`/atendimento/${id}/cliente`)).toBe(true);
  expect(isConversationPath("/atendimento")).toBe(false);
  expect(isConversationPath("/atendimento/abc")).toBe(false);
  expect(isConversationPath("/funil")).toBe(false);
  expect(isConversationPath(`/atendimento/${"-".repeat(36)}`)).toBe(false); // só parece UUID
  expect(isConversationPath(null)).toBe(false);
});

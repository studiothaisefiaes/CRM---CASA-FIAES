import { expect, it } from "vitest";
import { mergeNotes } from "./notes-merge";

it("junta as anotações dos leads na ordem das conversas, com o dia, sem apagar o que já havia", () => {
  const r = mergeNotes("Cliente desde 2020.", [
    { at: "2026-10-14T13:00:00Z", text: "Quer luzes" },
    { at: "2026-09-01T13:00:00Z", text: "Alérgica a amônia" },
  ]);
  expect(r).toEqual({ added: 2, text: "Cliente desde 2020.\n\n— Anotação da conversa de 01/09/2026 —\nAlérgica a amônia\n\n— Anotação da conversa de 14/10/2026 —\nQuer luzes" });
});
it("idempotente: rodar de novo não repete; texto vazio não entra; sem nada, continua null", () => {
  const once = mergeNotes(null, [{ at: "2026-10-14T13:00:00Z", text: " Quer luzes " }]);
  expect(mergeNotes(once.text, [{ at: "2026-10-14T13:00:00Z", text: "Quer luzes" }])).toEqual({ text: once.text, added: 0 });
  expect(mergeNotes(null, [{ at: "2026-10-14T13:00:00Z", text: "   " }])).toEqual({ text: null, added: 0 });
});

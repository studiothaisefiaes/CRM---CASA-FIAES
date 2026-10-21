import { expect, it } from "vitest";
import { alertAckKey, imageUseLabel, NO_IMAGE_USE_TEXT, popupLines } from "./client-alert";

it("linhas do aviso + 'Não autorizou uso de imagem'; vazio → []", () => {
  expect(popupLines({ alertNotes: "Alérgica a amônia\n\n Não cobrar café ", imageUse: "nao" }))
    .toEqual(["Alérgica a amônia", "Não cobrar café", "Não autorizou uso de imagem"]);
  expect(popupLines({ alertNotes: null, imageUse: "sim" })).toEqual([]);
  expect(popupLines({ alertNotes: "  ", imageUse: null })).toEqual([]);
  expect(NO_IMAGE_USE_TEXT).toBe("Não autorizou uso de imagem");
});
it("o texto configurado troca a linha do uso de imagem; vazio volta ao sugerido", () => {
  expect(popupLines({ alertNotes: null, imageUse: "nao" }, "Sem foto, por favor")).toEqual(["Sem foto, por favor"]);
  expect(popupLines({ alertNotes: null, imageUse: "nao" }, "  ")).toEqual([NO_IMAGE_USE_TEXT]);
});
it("texto novo muda a chave; mesma visita e mesmo texto, mesma chave", () => {
  expect(alertAckKey({ contactId: "c", scope: "v", lines: ["a"] })).not.toBe(alertAckKey({ contactId: "c", scope: "v", lines: ["b"] }));
  expect(alertAckKey({ contactId: "c", scope: "v", lines: ["a"] })).toBe(alertAckKey({ contactId: "c", scope: "v", lines: ["a"] }));
  expect(alertAckKey({ contactId: "c", scope: "v", lines: ["a"] })).not.toBe(alertAckKey({ contactId: "c", scope: "w", lines: ["a"] }));
});
it("a ficha mostra Sim (com a data, se houver), Não ou Não informado", () => {
  expect(imageUseLabel("sim", "2026-03-12")).toBe("Sim, desde 12/03/2026");
  expect(imageUseLabel("sim", null)).toBe("Sim");
  expect(imageUseLabel("nao", null)).toBe("Não");
  expect(imageUseLabel(null, null)).toBe("Não informado");
});

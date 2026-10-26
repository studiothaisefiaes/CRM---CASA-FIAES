import { expect, it } from "vitest";
import { composerHasText, offerDraft, onDraft, reportComposerText } from "./composer-draft";

it("o texto oferecido chega no campo da conversa certa; sem o campo aberto, espera ele abrir; nada é enviado", () => {
  const got: string[] = [];
  const off = onDraft("d1", (t) => got.push(t));
  offerDraft("d1", "Oi, Paula! …");
  offerDraft("d2", "para outra conversa");
  expect(got).toEqual(["Oi, Paula! …"]);
  off();
  offerDraft("d1", "guardado");
  const later: string[] = [];
  onDraft("d1", (t) => later.push(t))();
  expect(later).toEqual(["guardado"]);
});

it("sabe se já tem texto escrito (para perguntar antes de trocar)", () => {
  expect(composerHasText("d3")).toBe(false);
  reportComposerText("d3", "  ");
  expect(composerHasText("d3")).toBe(false);
  reportComposerText("d3", "estava escrevendo");
  expect(composerHasText("d3")).toBe(true);
  reportComposerText("d3", "");
  expect(composerHasText("d3")).toBe(false);
});

it("o texto pode chegar com o anexo de uma resposta pronta preso (sugestão da IA com vídeo); também espera o campo abrir", () => {
  const anexo = { replyFile: { replyId: "q9", name: "metodo.mp4", kind: "video" } };
  const got: unknown[][] = [];
  const off = onDraft("d7", (...a) => got.push(a));
  offerDraft("d7", "Assista ao vídeo!", anexo);
  expect(got).toEqual([["Assista ao vídeo!", anexo]]);
  off();
  offerDraft("d7", "guardado com anexo", anexo);
  const later: unknown[][] = [];
  onDraft("d7", (...a) => later.push(a))();
  expect(later).toEqual([["guardado com anexo", anexo]]);
});

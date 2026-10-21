import { expect, it } from "vitest";
import { viewerEvent } from "./live-scope";

const PRO = ["pro.app", "pro.ganhos"];
const EQUIPE = ["atendimento.ver", "quadro.ver"];

it("a equipe recebe o aviso como sempre (com o escopo)", () => {
  expect(JSON.parse(viewerEvent(JSON.stringify({ type: "mensagem_recebida", dealId: "d1" }), EQUIPE)!))
    .toEqual({ type: "mensagem_recebida", dealId: "d1", scope: ["queue", "deal:d1"] });
});

it("quem só tem o app da profissional recebe só 'a agenda mudou', sem nenhum dado", () => {
  expect(viewerEvent(JSON.stringify({ type: "agenda_alterada", day: "2026-10-16", dealId: "d1", scope: ["agenda"] }), PRO))
    .toBe(JSON.stringify({ type: "agenda_alterada", scope: ["agenda"] }));
  expect(viewerEvent(JSON.stringify({ type: "mensagem_recebida", dealId: "d1" }), PRO)).toBeNull();
  expect(viewerEvent(JSON.stringify({ type: "lead_criado", dealId: "d1" }), PRO)).toBeNull();
  expect(viewerEvent("isto não é json", PRO)).toBeNull();
});

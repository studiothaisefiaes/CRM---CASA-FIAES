import { describe, expect, it } from "vitest";
import { toColumns } from "@/lib/board-columns";
import type { BoardCard, BoardStage } from "@/server/queries/board";

const card = (id: string, awaiting: string | null): BoardCard => ({ id, contactId: id, hasAvatar: false, contactName: id, phone: "+5571999990000", origin: "x", ownerId: null, ownerName: null,
  stageId: "s", awaitingReplySince: awaiting, stageEnteredAt: "2026-10-20T10:00:00Z", lastMessage: null, lastMessageKind: null, lastMessageAt: null, lastDirection: null,
  isClient: true, scheduledAt: null, valueCents: null, urgency: "idle", waitSeconds: 0, followupAttempt: 0, pkg: null });
const stage = (key: string, kind: string, cards: BoardCard[]): BoardStage => ({ id: key, key, name: key, kind, slaMinutes: null, color: "#000", cards });

describe("quem escreveu aparece no topo de Em conversa (20/10)", () => {
  const stages = [
    stage("conversa", "atendimento", [card("quieta-c", null), card("nova", "2026-10-20T15:00:00Z")]),
    stage("agendado", "agendado", [card("dezembro", "2026-10-20T13:00:00Z"), card("quieta", null)]),
    stage("fechado", "fechado", [card("ganha", "2026-10-20T12:00:00Z")]),
  ];
  it("de qualquer etapa aberta, a mais antiga primeiro, com a etapa de origem; depois as da própria coluna", () => {
    const conversa = toColumns(stages).find((c) => c.id === "conversa")!;
    expect(conversa.cards.map((c) => c.id)).toEqual(["dezembro", "nova", "quieta-c"]);
    expect(conversa.cards[0]).toMatchObject({ esperando: true, stageName: "agendado" });
    expect(conversa.cards[1].stageName).toBeUndefined();
  });
  it("o card sai da coluna de origem enquanto espera; fechado não entra", () => {
    const cols = toColumns(stages);
    expect(cols.find((c) => c.id === "agendado")!.cards.map((c) => c.id)).toEqual(["quieta"]);
    expect(cols.find((c) => c.id === "fechado")!.cards.map((c) => c.id)).toEqual(["ganha"]);
  });
  it("respondida (sem espera), fica na coluna dela", () => {
    expect(toColumns([stage("conversa", "atendimento", []), stage("agendado", "agendado", [card("q", null)])]).find((c) => c.id === "agendado")!.cards).toHaveLength(1);
  });
  it("Para retomar: roxa, logo depois de Em conversa, com quem tem retomada e não espera a Casa; Orçamento fica onde está (20/10)", () => {
    const r = (id: string, at: string, awaiting: string | null = null): BoardCard => ({ ...card(id, awaiting), retomarAt: at });
    const cols = toColumns([
      stage("conversa", "atendimento", [r("depois", "2026-10-25T13:00:00Z"), r("antes", "2026-10-22T13:00:00Z"), r("escreveu", "2026-10-22T13:00:00Z", "2026-10-20T15:00:00Z")]),
      stage("orcamento", "proposta", [r("orc", "2026-10-21T13:00:00Z")]),
    ]);
    expect(cols.map((c) => c.id)).toEqual(["conversa", "retomar", "orcamento"]);
    expect(cols[1].cards.map((c) => c.id)).toEqual(["antes", "depois"]);
    expect(cols[0].cards.map((c) => c.id)).toEqual(["escreveu"]);
    expect(cols[2].cards.map((c) => c.id)).toEqual(["orc"]);
  });
});

import { it, expect } from "vitest";
import { lastMessageOf } from "./last-message";
import { outMeta } from "@/lib/authorship";

it("balão inicial (antes do histórico chegar) diz por onde a mensagem saiu", () => {
  const m = lastMessageOf({ dealId: "d", contactId: "c", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 5,
    lastMessage: "*CATI - CASA FIAES:*\nOi", lastKind: "text", lastDirection: "out", lastAt: null, lastAuthorName: "Cati", lastSentVia: "celular",
    stageKey: "atendimento", stageName: "Em conversa", sourceLabel: "", ownerName: null, signals: [], tags: [] });
  expect(outMeta(m)).toBe("Cati · pelo celular · ");
});

it("nome do cabeçalho e do painel em Título (contato salvo em MAIÚSCULAS); só telefone vira telefone formatado", async () => {
  const { paneName } = await import("./last-message");
  const item = { dealId: "d", contactId: "c", name: "THAMIRES SOUZA", phone: "+5571990000002", hasAvatar: false, awaitingSince: null, slaMinutes: 5,
    lastMessage: null, lastKind: null, lastDirection: null, lastAt: null, stageKey: "atendimento", stageName: "Em conversa", sourceLabel: "", ownerName: null, signals: [], tags: [] };
  expect(paneName(null, item)).toBe("Thamires Souza");
  expect(paneName({ contact: { name: "THAMIRES SOUZA", phoneE164: "+5571990000002" } }, null)).toBe("Thamires Souza");
  expect(paneName({ contact: { name: null, phoneE164: "+5571990000002" } }, null)).toBe("(71) 99000-0002");
});

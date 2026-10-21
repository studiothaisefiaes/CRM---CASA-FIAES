import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Revisão de segurança 17/10 (M1): toda action da conversa e do funil que recebe o id de uma conversa (ou de uma mensagem ou de um
 * item do outbox) confere o escopo com assertCanActOnDeal/OnMessage/OnOutbox. As exceções ficam aqui, com o motivo.
 */
const FILES = ["src/app/(app)/conversa/actions.ts", "src/app/(app)/funil/actions.ts", "src/app/(app)/conversa/ai-actions.ts", "src/app/(app)/atendimento/actions.ts"];
const EXCEPTIONS: Record<string, string> = {
  bulkResumeAction: "em massa: actionableIds(ids, user) já filtra pelo mesmo escopo",
  bulkResolveAction: "em massa: bulkResolve(ids, user) já filtra pelo mesmo escopo",
  bulkAssignAction: "em massa: bulkAssign(ids, owner, user) já filtra pelo mesmo escopo",
  bulkMoveAction: "em massa: bulkMove(ids, etapa, user) já filtra pelo mesmo escopo",
  getConversationAction: "conversationFor (queries/conversation.ts) confere o escopo e devolve o texto",
  nextWaitingAction: "só devolve o próximo da Fila de quem pede (nextWaitingId usa o escopo dela)",
  createLeadAction: "cria um lead novo (não age sobre um existente)",
  newConversationAction: "acha ou cria a conversa pelo telefone (não recebe id de conversa)",
  setTeamContactAction: "age no contato (ficha), não na conversa",
  setContactKindAction: "age no contato (ficha), não na conversa",
};
/** Recebem o id do item do outbox com outro nome. */
const OUTBOX_BY_ID = new Set(["cancelScheduledAction", "sendScheduledNowAction"]);

describe("escopo da conversa em toda action por id", () => {
  for (const file of FILES) {
    it(file, () => {
      const code = readFileSync(path.resolve(file), "utf8");
      const re = /export (?:async function (\w+)\s*\(|const (\w+)\s*=\s*async\b)/g;
      const starts = [...code.matchAll(re)].map((m) => ({ name: m[1] ?? m[2], at: m.index! }));
      const missing = starts.filter((s, i) => {
        const body = code.slice(s.at, starts[i + 1]?.at ?? code.length);
        const byId = /\b(dealIds?|messageId|outboxId)\b/.test(body) || OUTBOX_BY_ID.has(s.name);
        return byId && !EXCEPTIONS[s.name] && !/\bassertCanActOn(Deal|Message|Outbox)\(/.test(body);
      }).map((s) => s.name);
      expect(missing).toEqual([]);
    });
  }
});

import { expect, it } from "vitest";
import { aiFailureMessage } from "./ai-failure";

it("psico r68 #22: cada causa da IA vira uma frase que diz o que fazer", () => {
  expect(aiFailureMessage("sem_chave: A chave da IA não está configurada no servidor.")).toBe("A IA não está configurada no servidor. Avise a gestão.");
  expect(aiFailureMessage("http: A IA respondeu 401: invalid x-api-key")).toBe("A chave da IA foi recusada. Avise a gestão.");
  expect(aiFailureMessage("http: A IA respondeu 429: rate limit")).toBe("O limite da IA foi atingido. Avise a gestão.");
  expect(aiFailureMessage("http: A IA respondeu 400: credit balance is too low")).toBe("O limite da IA foi atingido. Avise a gestão.");
  expect(aiFailureMessage("timeout: A IA demorou demais para responder.")).toContain("Tente de novo");
  expect(aiFailureMessage("rede: Sem conexão com a IA: x")).toContain("Tente de novo");
  expect(aiFailureMessage("recusa: A IA recusou esta conversa.")).toContain("recusou");
  expect(aiFailureMessage("ilegivel: x")).toContain("embaralhado");
  expect(aiFailureMessage("formato: x")).toBe("A IA não respondeu. Tente de novo em instantes.");
});

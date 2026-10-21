import { ILEGIVEL_MSG } from "@/server/ai/client";

/**
 * Psico r68 #22: a falha da IA diz a causa, para a atendente saber se tenta de novo (rede, demora) ou avisa a gestão (chave, limite).
 * `erro` é o texto que `generateForDeal` e `generateProgramada` devolvem: "<código>: <mensagem>".
 */
export function aiFailureMessage(erro: string): string {
  if (erro.startsWith("ilegivel")) return ILEGIVEL_MSG;
  const [code, ...rest] = erro.split(": ");
  const detail = rest.join(": ").toLowerCase();
  const status = Number(/respondeu (\d{3})/.exec(detail)?.[1] ?? 0);
  if (code === "sem_chave") return "A IA não está configurada no servidor. Avise a gestão.";
  if (code === "http" && (status === 401 || status === 403)) return "A chave da IA foi recusada. Avise a gestão.";
  if (code === "http" && (status === 402 || status === 429 || /credit|quota|limit|billing/.test(detail))) return "O limite da IA foi atingido. Avise a gestão.";
  if (code === "timeout" || code === "rede" || (code === "http" && status >= 500)) return "A IA demorou ou ficou sem conexão. Tente de novo em instantes.";
  if (code === "recusa") return "A IA recusou esta conversa. Escreva a resposta à mão.";
  return "A IA não respondeu. Tente de novo em instantes.";
}

import { PAY_LABEL } from "@/lib/comanda-math";
import { normText } from "../../domain/avec/normalize";

/**
 * Formas de pagamento do Financeiro: a do CRM (chave) e a do Avec (texto com bandeira, "Cartão Crédito (Visa)") na mesma chave, para
 * comparar lado a lado. O que não se conhece fica como "outra:<nome original>" (Dívida, Voucher…). Puro.
 */
export const METHOD_ORDER = ["pix", "credito", "debito", "dinheiro", "credito_cliente", "cortesia"] as const;
const LABEL: Record<string, string> = { ...PAY_LABEL, cortesia: "Cortesia" };
const OUTRA = "outra:";
/** Não é dinheiro que entrou: aparece em Formas e Exceções, fora das Entradas. */
const NOT_REVENUE = new Set(["cortesia"]);

export function methodKey(raw: string | null): string {
  const t = (raw ?? "").trim();
  if (!t) return `${OUTRA}Não informada`;
  if ((METHOD_ORDER as readonly string[]).includes(t)) return t;
  const n = normText(t);
  if (n.includes("credito cliente") || n.includes("credito da cliente")) return "credito_cliente";
  if (n === "pix" || n.startsWith("pix ")) return "pix";
  if (n.includes("debito")) return "debito";
  if (n.includes("credito")) return "credito";
  if (n === "dinheiro" || n.startsWith("dinheiro ")) return "dinheiro";
  if (n === "cortesia") return "cortesia";
  return `${OUTRA}${t}`;
}

export const methodLabel = (key: string): string => (key.startsWith(OUTRA) ? key.slice(OUTRA.length) : LABEL[key] ?? key);
export const isRevenue = (key: string): boolean => !NOT_REVENUE.has(key);
/** Ordem de tela: as conhecidas na ordem fixa, as outras por nome. */
export const methodRank = (key: string): number => { const i = (METHOD_ORDER as readonly string[]).indexOf(key); return i < 0 ? METHOD_ORDER.length : i; };

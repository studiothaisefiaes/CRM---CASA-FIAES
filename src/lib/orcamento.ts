import { z } from "zod";

/**
 * Orçamento do Método em PDF (Cati 27/10: "a foto do antes, a foto do depois, com orçamento, tudo já em PDF, para enviar pelo CRM").
 * A atendente escolhe as fotos da conversa e os itens (pacotes e serviços com o preço); o PDF sai pela página /imprimir/orcamento.
 * Módulo puro (tela e servidor): o pedido viaja codificado na URL da página de impressão.
 */
export const MAX_ITENS = 12;
export const orcamentoSchema = z.object({
  dealId: z.string().uuid(),
  antesId: z.string().uuid().nullish(),
  depoisId: z.string().uuid().nullish(),
  itens: z.array(z.object({ nome: z.string().trim().min(1).max(120), valorCents: z.number().int().min(0).max(100_000_000) })).min(1).max(MAX_ITENS),
  validadeDias: z.number().int().min(1).max(90).default(7),
  obs: z.string().max(600).nullish(),
});
export type Orcamento = z.infer<typeof orcamentoSchema>;
export type OrcamentoInput = z.input<typeof orcamentoSchema>;

export const encodeOrcamento = (o: Orcamento) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
export const decodeOrcamento = (s: string): Orcamento | null => {
  try { const r = orcamentoSchema.safeParse(JSON.parse(Buffer.from(s, "base64url").toString("utf8"))); return r.success ? r.data : null; } catch { return null; }
};
export const totalCents = (o: Pick<Orcamento, "itens">) => o.itens.reduce((n, i) => n + i.valorCents, 0);
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "Orçamento Método Fiaes® - Ana Souza.pdf" (só letras, números e espaço no nome). */
export const orcamentoFileName = (nome: string | null) => `Orçamento Método Fiaes®${nome?.trim() ? ` - ${nome.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60)}` : ""}.pdf`;

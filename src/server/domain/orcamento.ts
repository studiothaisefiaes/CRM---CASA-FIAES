import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, lists, messages } from "../db/schema";
import { encodeOrcamento, orcamentoFileName, orcamentoSchema, type OrcamentoInput } from "@/lib/orcamento";
import { renderPagePdf } from "../reports/pdf";
import { listPackageDefs } from "./caixa/packages";
import { sendMediaFromCrm } from "./send";
import { UserFacingError } from "./errors";

/** As fotos desta conversa (de qualquer conversa da cliente), mais novas primeiro: as opções de "antes" e "depois". */
export async function orcamentoFotos(dealId: string) {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  const rows = await db.select({ id: messages.id, direction: messages.direction, at: messages.createdAt }).from(messages)
    .where(and(eq(messages.contactId, d.contactId), eq(messages.kind, "image"), isNull(messages.deletedAt), isNull(messages.mediaPurgedAt)))
    .orderBy(desc(messages.createdAt)).limit(40);
  return rows.map((r) => ({ id: r.id, deCliente: r.direction === "in", at: r.at.toISOString() }));
}

/** O que dá para pôr no orçamento: pacotes ativos e serviços ativos com preço (o preço vem preenchido e pode mudar). */
export async function orcamentoOpcoes() {
  const [pacotes, servicos] = await Promise.all([
    listPackageDefs({ activeOnly: true }),
    db.select({ label: lists.label, priceCents: lists.priceCents }).from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true))).orderBy(lists.label),
  ]);
  return [
    ...pacotes.map((p) => ({ nome: p.name, valorCents: p.priceCents ?? 0, tipo: "pacote" as const })),
    ...servicos.map((s) => ({ nome: s.label, valorCents: s.priceCents ?? 0, tipo: "servico" as const })),
  ];
}

/** Confere o pedido: as fotos são mensagens desta cliente. */
async function check(input: OrcamentoInput) {
  const o = orcamentoSchema.parse(input);
  const [d] = await db.select({ contactId: deals.contactId, name: contacts.name }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, o.dealId));
  if (!d) throw new UserFacingError("Essa conversa não existe mais.");
  const ids = [o.antesId, o.depoisId].filter((x): x is string => !!x);
  if (ids.length) {
    const ok = await db.select({ id: messages.id }).from(messages).where(and(inArray(messages.id, ids), eq(messages.contactId, d.contactId), eq(messages.kind, "image")));
    if (ok.length !== new Set(ids).size) throw new UserFacingError("Escolha as fotos desta conversa.");
  }
  return { o, name: d.name };
}

/** O PDF (para ver antes de enviar). Nada é enviado. */
export async function renderOrcamento(input: OrcamentoInput, userId: string): Promise<{ pdf: Buffer; fileName: string }> {
  const { o, name } = await check(input);
  const pdf = await renderPagePdf({ path: "/imprimir/orcamento", params: { d: encodeOrcamento(o) }, userId });
  return { pdf, fileName: orcamentoFileName(name) };
}

/** Gera e envia o PDF na conversa, como documento, só no toque da atendente. */
export async function sendOrcamento(input: OrcamentoInput, caption: string | null, userId: string) {
  const { pdf, fileName } = await renderOrcamento(input, userId);
  return sendMediaFromCrm(orcamentoSchema.parse(input).dealId, { name: fileName, mime: "application/pdf", data: pdf }, caption?.trim() || null, userId, { sign: !!caption?.trim() });
}

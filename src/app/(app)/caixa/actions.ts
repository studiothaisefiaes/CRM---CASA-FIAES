"use server";
import { cancelAppointments } from "@/server/domain/agenda/visits";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import type { SessionUser } from "@/server/auth/sessions-store";
import type { Perm } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { CARD_BRANDS, PAY_METHODS } from "@/lib/comanda-math";
import { CASH_DENOMINATIONS_CENTS } from "@/lib/cash-denominations";
import {
  addItem, addPayment, ApprovalNeededError, cancelComanda, CashClosedError, closeComanda, discardComanda, undoDiscardComanda, joinTodayAppointments, openComandaForAppointment, openWalkInComanda,
  removeItem, removePayment, reopenComanda, reopenForCorrection, setComandaClient, setComandaCpf, setComandaNota, setComandaDiscount, updateItem, ITEM_KINDS,
} from "@/server/domain/caixa/comandas";
import { redeemLoyalty } from "@/server/domain/fidelidade";
import { setItemAssistants } from "@/server/domain/caixa/assistants";
import { addMovement, cancelMovement, closeCash, openCash, reopenCash, userHasPerm } from "@/server/domain/caixa/cash";
import { getCaixaRules, saveCaixaRules, saveCaixaSettings } from "@/server/domain/caixa/mode";
import { saveCaixaRecursos } from "@/server/domain/caixa/recursos";
import { RECIBO_TEXTO_MAX, RECURSO_KEYS, type CaixaRecursos, type RecursoKey } from "@/lib/caixa-recursos";
import { UserFacingError } from "@/server/domain/errors";
import { checkCredentials } from "@/server/auth/users";
import { allow } from "@/server/auth/rate-limit";
import { getCaixaQueue, isBlindFor, queueFor } from "@/server/queries/caixa";
import { extendPackage, setPackageSessionValue } from "@/server/domain/caixa/packages";
import { applyCommissionToCategory, setCommission } from "@/server/domain/caixa/commission";
import { clientPackagesFor, getComandaDetail } from "@/server/queries/caixa";
import { userErrorMessage } from "@/server/user-error";
import { cancelNfse, emitNfse } from "@/server/domain/fiscal/nfse";
import { cancelNfce, emitNfce } from "@/server/domain/fiscal/nfce/nfce";
import { RESOLVER_ESCOLHAS, resolverNotaForaDoCrm } from "@/server/domain/fiscal/resolver";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; needsCash?: boolean; needsApproval?: boolean };

const actorOf = (u: SessionUser) => ({ id: u.id, perms: u.perms });
const uuid = (v: string) => z.string().uuid().parse(v);
const cents = z.number().int().min(0).max(100_000_000);

async function run<T>(perm: Perm, fn: (u: SessionUser) => Promise<T>, opts: { fallback?: string; revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const u = await assertPerm(perm);
    const data = await fn(u);
    if (opts.revalidate !== false) { revalidatePath("/caixa"); revalidatePath("/agenda"); }
    return { ok: true, data };
  } catch (e) {
    const error = userErrorMessage(e, "caixa", opts.fallback ?? "Não foi possível registrar. Tente de novo.");
    return e instanceof CashClosedError ? { ok: false, error, needsCash: true } : e instanceof ApprovalNeededError ? { ok: false, error, needsApproval: true } : { ok: false, error };
  }
}

/** Aprovação da gestão, como no fechamento: a gestão aprova a própria com um clique (`self`); a equipe chama alguém da gestão (e-mail e senha). */
const approvalInput = z.union([z.object({ self: z.literal(true) }), z.object({ email: z.string().max(200), password: z.string().max(200) })]).nullish();
export type Approval = z.input<typeof approvalInput>;
async function approverOf(u: SessionUser, approval: Approval, notApprover = "Essa pessoa não aprova pela gestão do caixa. Chame alguém da gestão."): Promise<string | null> {
  const a = approvalInput.parse(approval);
  if (!a) return null;
  if ("self" in a) {
    if (!can(u.perms, "caixa.gerir")) throw new UserFacingError("Peça a aprovação de alguém da gestão.");
    return u.id;
  }
  if (!allow(`caixa-aprovar:${u.id}`, 5)) throw new UserFacingError("Muitas tentativas. Espere alguns minutos.");
  const who = await checkCredentials(a.email, a.password);
  if (!who) throw new UserFacingError("E-mail ou senha da gestão não conferem.");
  if (!(await userHasPerm(who.id, "caixa.gerir"))) throw new UserFacingError(notApprover);
  return who.id;
}

const itemInput = z.object({
  kind: z.enum(ITEM_KINDS), serviceId: z.string().uuid().nullish(), label: z.string().max(120).nullish(), professionalId: z.string().uuid().nullish(),
  qty: z.number().positive().max(99).optional(), unitCents: cents.nullish(), discountCents: cents.nullish(), discountPercent: z.number().min(0).max(100).nullish(),
  clientPackageId: z.string().uuid().nullish(), packageDefId: z.string().uuid().nullish(), productId: z.string().uuid().nullish(), reason: z.string().max(300).nullish(),
  /** Item "divida" ("Cobrar junto"): a comanda cuja dívida ele quita. Quitar não depende de caixa.divida nem do recurso ligado. */ settlesComandaId: z.string().uuid().nullish(),
});
const itemPatch = itemInput.omit({ kind: true, serviceId: true, clientPackageId: true, packageDefId: true, productId: true, settlesComandaId: true }).partial();

/* Comanda: quem opera o caixa (caixa.operar). */
export const comandaDetailAction = async (id: string) => run("caixa.operar", (u) => getComandaDetail(uuid(id), u.id, u.perms), { revalidate: false });
export const queueAction = async () => run("caixa.operar", async (u) => queueFor(await getCaixaQueue(), isBlindFor(await getCaixaRules(), u)), { revalidate: false });
export const openComandaAction = async (appointmentId: string) => run("caixa.operar", (u) => openComandaForAppointment(uuid(appointmentId), actorOf(u)));
/** "Nova comanda": nasce com o primeiro item, nunca vazia (QA r58, I-8). */
/** A cliente escolhida na busca ou a cliente nova (nome + celular), como no Marcar (22/10). */
const clientRef = z.union([z.object({ contactId: z.string().uuid() }), z.object({ name: z.string().trim().min(1).max(120), phone: z.string().min(8).max(20) })]);
export const openWalkInAction = async (input: { contactId?: string | null; client?: z.input<typeof clientRef> | null; clientName?: string | null; requestKey: string; item: z.input<typeof itemInput>; approval?: Approval }) =>
  run("caixa.operar", async (u) => {
    const p = z.object({ contactId: z.string().uuid().nullish(), client: clientRef.nullish(), clientName: z.string().max(120).nullish(), requestKey: z.string().uuid(), item: itemInput }).parse(input);
    return openWalkInComanda({ ...p, item: { ...p.item, approverId: await approverOf(u, input.approval) } }, actorOf(u));
  }, { fallback: "Escolha o primeiro item da comanda." });
/** Usar o prêmio da fidelidade na comanda aberta (quem tem fidelidade.resgatar; o domínio confere a permissão e a função). `target`: um item que já está na comanda ou um serviço novo com a profissional. */
export const redeemLoyaltyAction = async (comandaId: string, programId: string, target: { itemId: string } | { serviceId: string; professionalId: string }) =>
  run("caixa.operar", async (u) => {
    await assertPerm("fidelidade.resgatar"); // além de operar o caixa: quem usa o prêmio precisa da permissão própria
    return redeemLoyalty(uuid(comandaId), uuid(programId),
      "itemId" in target ? { itemId: uuid(target.itemId) } : { serviceId: uuid(target.serviceId), professionalId: uuid(target.professionalId) }, actorOf(u));
  }, { fallback: "Não foi possível usar o prêmio. Tente de novo." });
export const joinTodayAction = async (comandaId: string) => run("caixa.operar", (u) => joinTodayAppointments(uuid(comandaId), actorOf(u)));
/* Desconto, preço abaixo da tabela e cortesia acima do limite da Casa pedem a gestão (`approval`, QA r58, I-11); a tela recebe needsApproval. */
export const addItemAction = async (comandaId: string, input: z.input<typeof itemInput>, approval?: Approval) =>
  run("caixa.operar", async (u) => addItem(uuid(comandaId), { ...itemInput.parse(input), approverId: await approverOf(u, approval) }, actorOf(u)));
export const updateItemAction = async (itemId: string, patch: z.input<typeof itemPatch>, approval?: Approval) =>
  run("caixa.operar", async (u) => { const p = itemPatch.parse(patch); return updateItem(uuid(itemId), { ...p, label: p.label ?? undefined, approverId: await approverOf(u, approval) }, actorOf(u)); });
/** Põe e tira as assistentes do serviço (caixa.assistente, não caixa.operar). A ordem da lista vira a posição. */
export const setAssistantsAction = async (itemId: string, input: { professionalIds: string[] }) =>
  run("caixa.assistente", (u) => setItemAssistants(uuid(itemId), { professionalIds: z.array(z.string().uuid()).max(2).parse(input.professionalIds) }, actorOf(u)));
export const removeItemAction = async (itemId: string, input: { reason?: string | null } = {}) =>
  run("caixa.operar", (u) => removeItem(uuid(itemId), { reason: z.string().max(300).nullish().parse(input.reason) }, actorOf(u)));
export const setDiscountAction = async (comandaId: string, input: { cents?: number | null; percent?: number | null; reason?: string | null; approval?: Approval }) =>
  run("caixa.operar", async (u) => setComandaDiscount(uuid(comandaId), { ...z.object({ cents: cents.nullish(), percent: z.number().min(0).max(100).nullish(), reason: z.string().max(300).nullish() }).parse(input),
    approverId: await approverOf(u, input.approval) }, actorOf(u)));
/** Nota fiscal no recebimento: a escolha da recepção fica gravada na comanda (nada é emitido por aqui). */
export const setNotaAction = async (comandaId: string, input: { escolha: "nao" | "sem_cpf" | "com_cpf"; cpf?: string | null }) =>
  run("caixa.operar", (u) => setComandaNota(uuid(comandaId), z.object({ escolha: z.enum(["nao", "sem_cpf", "com_cpf"]), cpf: z.string().max(20).nullish() }).parse(input), actorOf(u)));
export const setCpfAction = async (comandaId: string, cpf: string | null) => run("caixa.operar", (u) => setComandaCpf(uuid(comandaId), z.string().max(20).nullable().parse(cpf), actorOf(u)));
/** Reabrir a comanda fechada, com motivo: do dia, quem opera o caixa; de outro dia, o domínio pede caixa.gerir. */
export const reopenComandaAction = async (comandaId: string, input: { reason: string }) =>
  run("caixa.operar", (u) => reopenComanda(uuid(comandaId), { reason: z.string().max(300).parse(input.reason) }, actorOf(u)));
export const setClientAction = async (comandaId: string, input: { contactId?: string | null; client?: z.input<typeof clientRef> | null; clientName?: string | null }) =>
  run("caixa.operar", (u) => setComandaClient(uuid(comandaId), z.object({ contactId: z.string().uuid().nullish(), client: clientRef.nullish(), clientName: z.string().max(120).nullish() }).parse(input), actorOf(u)));
const paymentInput = z.object({
  method: z.enum(PAY_METHODS), valueCents: cents, installments: z.number().int().nullish(), brand: z.enum(CARD_BRANDS).nullish(),
  customMethodId: z.string().uuid().nullish(), note: z.string().max(200).nullish(),
});
export const addPaymentAction = async (comandaId: string, input: z.input<typeof paymentInput>, approval?: Approval) =>
  run("caixa.operar", async (u) => addPayment(uuid(comandaId), { ...paymentInput.parse(input), approverId: await approverOf(u, approval) }, actorOf(u)));
/** Estorno de um pagamento (comanda aberta), com motivo opcional. */
export const removePaymentAction = async (paymentId: string, input: { reason?: string | null } = {}) =>
  run("caixa.operar", (u) => removePayment(uuid(paymentId), { reason: z.string().max(300).nullish().parse(input.reason) }, actorOf(u)));
/** Finalizar (caixa.operar). Deixar o que falta como dívida da cliente pede também caixa.divida, conferida aqui no servidor. */
export const closeComandaAction = async (comandaId: string, input: { saveChangeAsCredit?: boolean; leaveDebt?: boolean }) =>
  run("caixa.operar", async (u) => {
    if (input.leaveDebt) await assertPerm("caixa.divida");
    return closeComanda(uuid(comandaId), { saveChangeAsCredit: !!input.saveChangeAsCredit, leaveDebt: !!input.leaveDebt }, actorOf(u));
  }, { fallback: "Não foi possível fechar a comanda. Tente de novo." });
/** "Cancelar" no cartão da lista (caixa.cancelar): comanda aberta sai com motivo; já paga pede o estorno antes (a mesma regra do descarte). */
export const cancelarComandaAction = async (comandaId: string, reason: string) => run("caixa.cancelar", (u) => {
  const motivo = z.string().trim().min(1, "Escreva o motivo.").max(300).parse(reason);
  return discardComanda(uuid(comandaId), actorOf(u), new Date(), { reason: motivo });
});
/** "Cancelar" numa agendada (caixa.cancelar): cancela os horários ativos da visita na Agenda, com motivo. */
export const cancelarAgendadaAction = async (appointmentId: string, reason: string) => run("caixa.cancelar", async (u) => {
  const motivo = z.string().trim().min(1, "Escreva o motivo.").max(200).parse(reason);
  return cancelAppointments({ appointmentId: uuid(appointmentId), scope: "visita", reason: "outro", note: motivo, via: "recepcao" }, actorOf(u));
});
/** Desfazer o cancelamento de uma comanda aberta, por 10 minutos (psico r68 #1; caixa.cancelar, a mesma de cancelar). */
export const undoCancelarComandaAction = async (comandaId: string) => run("caixa.cancelar", (u) => undoDiscardComanda(uuid(comandaId), actorOf(u)));
export const clientPackagesAction = async (contactId: string, day: string) => run("caixa.operar", () => clientPackagesFor(uuid(contactId), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day)), { revalidate: false });

/* Nota fiscal da comanda (Fase D): permissões próprias, atribuíveis por perfil. */
/** "Emitir nota" e "Emitir de novo" (nota.emitir): enfileira e tenta uma vez já; o worker continua se o governo não respondeu. */
export const emitirNota = async (comandaId: string) => run("nota.emitir", (u) => emitNfse(uuid(comandaId), actorOf(u)), { fallback: "Não foi possível emitir a nota. Tente de novo." });
/** "Cancelar nota" (nota.cancelar): no governo, com o motivo de 15 a 255 letras. */
export const cancelarNota = async (docId: string, input: { reason: string }) =>
  run("nota.cancelar", (u) => cancelNfse(uuid(docId), { reason: z.string().max(300).parse(input.reason) }, actorOf(u)), { fallback: "Não foi possível cancelar a nota. Tente de novo." });
/** "Emitir NFC-e" (nota do produto; nota.emitir): a mesma fila da NFS-e. */
export const emitirNotaProduto = async (comandaId: string) => run("nota.emitir", (u) => emitNfce(uuid(comandaId), actorOf(u)), { fallback: "Não foi possível emitir a NFC-e. Tente de novo." });
/** "Cancelar NFC-e" (nota.cancelar): na SEFAZ, dentro do prazo de Configurações › Nota fiscal. */
export const cancelarNotaProduto = async (docId: string, input: { reason: string }) =>
  run("nota.cancelar", (u) => cancelNfce(uuid(docId), { reason: z.string().max(300).parse(input.reason) }, actorOf(u)), { fallback: "Não foi possível cancelar a NFC-e. Tente de novo." });

/**
 * "Resolver fora do CRM" (nota.resolver, só a Gestão): registra o que foi conferido no portal do governo quando o CRM não consegue
 * soltar a comanda sozinho (sem certificado, NFC-e fora do prazo, envio sem resposta). Não fala com o governo.
 */
export const resolverNotaFora = async (docId: string, input: { escolha: (typeof RESOLVER_ESCOLHAS)[number]; motivo: string; chave?: string | null }) =>
  run("nota.resolver", (u) => resolverNotaForaDoCrm(uuid(docId),
    z.object({ escolha: z.enum(RESOLVER_ESCOLHAS), motivo: z.string().max(300), chave: z.string().max(80).nullish() }).parse(input), actorOf(u)),
  { fallback: "Não foi possível registrar. Tente de novo." });

/* Caixa do dia (opcional, 7.9). */
export const openCashAction = async (input: { openingCents: number; notes?: string | null }) => run("caixa.operar", (u) => openCash(z.object({ openingCents: cents, notes: z.string().max(300).nullish() }).parse(input), actorOf(u)));
const valeInput = z.object({ professionalId: z.string().uuid(), password: z.string().min(1).max(200) });
export type MovementActionInput = { kind: "sangria" | "suprimento"; valueCents: number; reason: string; vale?: { professionalId: string; password: string } | null };
/** Sangria com `vale` pede também `caixa.vale` (conferido aqui e no domínio) e a senha da profissional. */
export const movementAction = async (input: MovementActionInput) =>
  run("caixa.operar", async (u) => {
    const data = z.object({ kind: z.enum(["sangria", "suprimento"]), valueCents: cents, reason: z.string().max(200), vale: valeInput.nullish() }).parse(input);
    if (data.vale) await assertPerm("caixa.vale");
    return addMovement(data, actorOf(u));
  });
/** Cancelar sangria/suprimento: no próprio caixa, `caixa.operar`; no de outra pessoa, `caixa.gerir` (o domínio confere de quem é). O vale da sangria cancela junto. */
export const cancelMovementAction = async (id: string, input: { reason: string }) =>
  run("caixa.operar", (u) => cancelMovement(uuid(id), { reason: z.string().max(300).parse(input?.reason ?? "") }, actorOf(u)));
const closeInput = z.object({
  sessionId: z.string().uuid().nullish(),
  cashBreakdown: z.partialRecord(z.enum(CASH_DENOMINATIONS_CENTS.map(String) as [string, ...string[]]), z.number().int().min(0).max(100_000)),
  counted: z.object({ pix: cents.nullish(), credito: cents.nullish(), debito: cents.nullish(), outra: cents.nullish() }),
  notes: z.string().max(300).nullish(),
  approval: approvalInput,
});
export type CloseCashActionInput = z.input<typeof closeInput>;

/**
 * Fechar o caixa. Diferença acima da tolerância: a gestão aprova a própria com um clique (`self`); quem não é gestão chama alguém da
 * gestão, que digita e-mail e senha ali mesmo (como o supervisor do Norte). Até 5 tentativas de senha a cada 10 minutos por pessoa.
 */
export const closeCashAction = async (input: CloseCashActionInput) =>
  run("caixa.operar", async (u) => {
    const { approval, ...rest } = closeInput.parse(input);
    const approverId = await approverOf(u, approval, "Essa pessoa não aprova diferença de caixa. Chame alguém da gestão.");
    const cashBreakdown = Object.fromEntries(Object.entries(rest.cashBreakdown).filter((e): e is [string, number] => e[1] != null));
    return closeCash({ ...rest, cashBreakdown, approverId }, actorOf(u));
  });

/* Gestão do caixa (caixa.gerir). */
export const cancelComandaAction = async (comandaId: string, input: { reason: string }) => run("caixa.gerir", (u) => cancelComanda(uuid(comandaId), { reason: z.string().max(300).parse(input.reason) }, actorOf(u)));
export const reopenForCorrectionAction = async (comandaId: string, input: { reason: string }) => run("caixa.gerir", (u) => reopenForCorrection(uuid(comandaId), { reason: z.string().max(300).parse(input.reason) }, actorOf(u)));
/** Reabrir um caixa fechado: com confirmação e motivo (QA r58, I-2). */
export const reopenCashAction = async (id: string, input: { reason: string }) =>
  run("caixa.gerir", (u) => reopenCash(uuid(id), { reason: z.string().max(300).parse(input?.reason ?? "") }, actorOf(u)));
/** Caixa › Caixas da equipe: tolerância, contagem cega, sangria grande e o limite de cortesia e desconto (null = desligado). */
export const saveCaixaRulesAction = async (input: { toleranciaCents: number; contagemCega: boolean; sangriaGrandeCents: number; aprovacaoDescontoBp?: number | null; notaPadrao?: "perguntar" | "nao" | "sem_cpf" }) =>
  run("caixa.gerir", (u) => saveCaixaRules(z.object({ notaPadrao: z.enum(["perguntar", "nao", "sem_cpf"]).optional(), toleranciaCents: cents, contagemCega: z.boolean(), sangriaGrandeCents: cents, aprovacaoDescontoBp: z.number().int().nullish() }).parse(input), u.id));
export const extendPackageAction = async (id: string, input: { validUntil: string }) => run("caixa.gerir", (u) => extendPackage(uuid(id), { validUntil: z.string().max(10).parse(input.validUntil) }, actorOf(u)));

/* Configuração (config.sistema): modo, valor por sessão e regras de comissão. Valem mesmo com o caixa no Avec. Os pacotes à venda ficam em Serviços e pacotes (servicos/actions). */
export const saveCaixaSettingsAction = async (input: { mode: "avec" | "crm"; exigeCaixaAberto: boolean }) =>
  run("config.sistema", (u) => saveCaixaSettings(z.object({ mode: z.enum(["avec", "crm"]), exigeCaixaAberto: z.boolean() }).parse(input), u.id));
/** Configurações › Caixa › "O que o caixa usa": liga/desliga, limites e texto do recibo. */
const recursosInput = z.object({
  ...(Object.fromEntries(RECURSO_KEYS.map((k) => [k, z.boolean()])) as Record<RecursoKey, z.ZodBoolean>),
  assistentesMax: z.number().int().min(1).max(20), valeSenhaTentativas: z.number().int().min(1).max(20), valeSenhaJanelaMin: z.number().int().min(1).max(120),
  reciboTexto: z.string().max(RECIBO_TEXTO_MAX), pagarComissaoDesde: z.string().max(10).nullable().optional(),
});
export const saveCaixaRecursosAction = async (input: CaixaRecursos) =>
  run("config.sistema", (u) => saveCaixaRecursos(recursosInput.parse(input) as CaixaRecursos, u.id), { fallback: "Confira os números, a data e o texto do recibo." });
export const setPackageSessionValueAction = async (id: string, unitCents: number | null) => run("config.sistema", (u) => setPackageSessionValue(uuid(id), cents.nullable().parse(unitCents), actorOf(u)));
export const setCommissionAction = async (input: { professionalId: string; serviceId: string; bp: number | null }) =>
  run("comissao.regras", (u) => setCommission(z.object({ professionalId: z.string().uuid(), serviceId: z.string().uuid(), bp: z.number().int().nullable() }).parse(input), actorOf(u)));
export const applyCommissionCategoryAction = async (input: { professionalId: string; category: string; bp: number | null }) =>
  run("comissao.regras", (u) => applyCommissionToCategory(z.object({ professionalId: z.string().uuid(), category: z.string().max(80), bp: z.number().int().nullable() }).parse(input), actorOf(u)));

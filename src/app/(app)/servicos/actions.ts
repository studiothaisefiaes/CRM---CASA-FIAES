"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAnyPerm, assertPerm } from "@/server/auth/session";
import { createService, updateService } from "@/server/domain/services";
import { setProfessionalServiceTerms } from "@/server/domain/professionals";
import { PRICE_KINDS } from "@/lib/service-price";
import { PACKAGE_DESCRIPTION_MAX, savePackageDef } from "@/server/domain/caixa/packages";
import { savePaymentOption } from "@/server/domain/caixa/payment-options";
import { saveAvecLoyaltyProgram, saveLoyaltyProgram, type LoyaltyProgramInput } from "@/server/domain/fidelidade-programas";
import { savePaymentFee } from "@/server/domain/caixa/payment-fees";
import { userErrorMessage } from "@/server/user-error";
import { addStockMovement, listStockMovements, saveProduct, type StockMovementRow } from "@/server/domain/estoque/produtos";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fields = z.object({
  label: z.string().max(200).optional(),
  category: z.string().max(200).nullable().optional(),
  priceCents: z.number().int().nullable().optional(),
  durationMin: z.number().int().nullable().optional(),
  bufferMin: z.number().int().nullable().optional(),
  cycleDays: z.number().int().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  professionalIds: z.array(z.string().uuid()).max(100).optional(),
  aiProIds: z.array(z.string().uuid()).max(100).nullable().optional(),
  aiProScope: z.enum(["sempre", "metodo"]).nullable().optional(),
  aiCitavel: z.boolean().optional(),
  /** 0084: custo (só com servicos.custo), como o preço aparece e "Pode ser feito junto com outro" (servicos.editar). */
  costCents: z.number().int().nullable().optional(),
  priceKind: z.enum(PRICE_KINDS).nullable().optional(),
  parallelOk: z.boolean().nullable().optional(),
  fiscalCtribNac: z.string().max(20).nullable().optional(),
  fiscalNbs: z.string().max(20).nullable().optional(),
});
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? "Confira os campos e tente de novo." : userErrorMessage(e, "servicos") });
/** A Agenda, o caixa, o agendamento pela internet e a IA leem os serviços: tudo que mostra serviço pega o novo na próxima abertura. */
const refresh = () => { revalidatePath("/servicos"); revalidatePath("/config", "layout"); };
/** Pacotes: o Caixa, a Agenda (vender pacote) e /pacotes leem também. */
const refreshPackages = () => { refresh(); revalidatePath("/caixa", "layout"); revalidatePath("/agenda"); revalidatePath("/pacotes"); };

/** O pedido mexe no custo? (0084: só quem tem servicos.custo vê e muda o custo.) */
const touchesCost = (v: object) => (v as { costCents?: unknown }).costCents !== undefined;
/** Mexe em algo além do custo? (o resto da ficha é servicos.editar) */
const touchesMore = (v: object) => Object.entries(v).some(([k, x]) => k !== "costCents" && x !== undefined);

/** Aba Serviços: só quem tem "Mudar serviços e preços" (gestão e recepção). A atendente só vê. O custo pede também servicos.custo. */
export async function createServiceAction(v: z.input<typeof fields> & { label: string }): Promise<R<{ id: string }>> {
  try {
    const u = await assertPerm("servicos.editar");
    if (touchesCost(v)) await assertPerm("servicos.custo");
    const data = await createService({ ...fields.parse(v), label: v.label }, u.id); refresh(); return { ok: true, data };
  } catch (e) { return fail(e); }
}
/** Editar: o custo pede servicos.custo; o resto, servicos.editar (quem só tem servicos.custo muda só o custo). */
export async function updateServiceAction(id: string, v: z.input<typeof fields>): Promise<R> {
  try {
    const cost = touchesCost(v);
    const u = cost ? await assertPerm("servicos.custo") : await assertPerm("servicos.editar");
    if (cost && touchesMore(v)) await assertPerm("servicos.editar");
    await updateService(z.string().uuid().parse(id), fields.parse(v), u.id); refresh(); return { ok: true };
  } catch (e) { return fail(e); }
}

const terms = z.object({ priceCents: z.number().int().nullable().optional(), durationMin: z.number().int().nullable().optional() }).strict();
/** Serviços › Quem faz: preço e tempo próprios da profissional (0084). Permissão própria; a função desligada é recusada no domínio. */
export async function setProServiceTermsAction(professionalId: string, serviceId: string, v: z.input<typeof terms>): Promise<R> {
  try {
    const u = await assertPerm("servicos.por_profissional");
    await setProfessionalServiceTerms(z.string().uuid().parse(professionalId), z.string().uuid().parse(serviceId), terms.parse(v), u.id);
    refresh(); revalidatePath("/agenda"); return { ok: true };
  } catch (e) { return fail(e); }
}

const pkg = z.object({
  id: z.string().uuid().nullish(), name: z.string().max(120), priceCents: z.number().int().min(0).nullable(), validityDays: z.number().int().nullable(),
  description: z.string().max(PACKAGE_DESCRIPTION_MAX * 2).nullable(), active: z.boolean(),
  items: z.array(z.object({ serviceId: z.string().uuid(), sessions: z.number().int(), unitCents: z.number().int().min(0).nullable() })).max(20),
});
/** Aba Serviços › Pacotes: criar e editar o pacote (nome, serviços × sessões, preço, validade, descrição para a IA, ativo). Mesma permissão dos serviços. */
export async function savePackageAction(v: z.input<typeof pkg>): Promise<R<{ id: string }>> {
  try { const u = await assertPerm("servicos.editar"); const data = await savePackageDef(pkg.parse(v), u); refreshPackages(); return { ok: true, data }; } catch (e) { return fail(e); }
}

/** Aba Formas de pagamento: a "Outra forma" que o caixa oferece (Transferência, Vale…). Só a gestão do caixa (caixa.gerir). */
export async function savePaymentOptionAction(v: { id?: string | null; label: string; active?: boolean }): Promise<R<{ id: string }>> {
  try {
    const u = await assertPerm("caixa.gerir");
    const data = await savePaymentOption(z.object({ id: z.string().uuid().nullish(), label: z.string().max(80), active: z.boolean().optional() }).parse(v), { id: u.id, perms: u.perms });
    revalidatePath("/servicos"); revalidatePath("/caixa", "layout");
    return { ok: true, data };
  } catch (e) { return fail(e); }
}

/** Aba Fidelidade: os programas (nome, meta, quais serviços contam e quais são prêmio…) e o programa que recebe o saldo do Avec. Só quem tem fidelidade.programas. */
const loyaltyFail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "fidelidade", "Não foi possível salvar o programa. Tente de novo.") });
export async function saveLoyaltyProgramAction(v: LoyaltyProgramInput): Promise<R<{ id: string }>> {
  try { const u = await assertPerm("fidelidade.programas"); const data = await saveLoyaltyProgram(v, u.id); revalidatePath("/servicos"); revalidatePath("/caixa", "layout"); return { ok: true, data }; } catch (e) { return loyaltyFail(e); }
}
export async function saveAvecLoyaltyProgramAction(programId: string | null): Promise<R> {
  try { const u = await assertPerm("fidelidade.programas"); await saveAvecLoyaltyProgram(programId, u.id); revalidatePath("/servicos"); return { ok: true }; } catch (e) { return loyaltyFail(e); }
}
const product = z.object({
  id: z.string().uuid().nullish(), name: z.string().max(120), brand: z.string().max(120).nullish(), category: z.string().max(120).nullish(), barcode: z.string().max(60).nullish(), ncm: z.string().max(20).nullish(), cfop: z.string().max(10).nullish(), csosn: z.string().max(10).nullish(),
  priceCents: z.number().int().min(0).nullable(), costCents: z.number().int().min(0).nullish(), use: z.enum(["venda", "consumo"]).optional(), minQty: z.number().min(0).nullish(), active: z.boolean().optional(),
});
const refreshEstoque = () => { revalidatePath("/servicos"); revalidatePath("/caixa", "layout"); revalidatePath("/agenda"); };

/** Aba Produtos: cadastrar e mudar produto. Só quem tem estoque.produtos; o domínio confere de novo e recusa com Produtos e estoque desligado. */
export async function salvarProduto(v: z.input<typeof product>): Promise<R<{ id: string }>> {
  try { const u = await assertPerm("estoque.produtos"); const p = product.parse(v); const data = await saveProduct({ ...p, id: p.id ?? undefined }, { id: u.id, perms: u.perms }); refreshEstoque(); return { ok: true, data }; } catch (e) { return fail(e); }
}

/** Aba Produtos: entrada, saída ou ajuste do estoque. Só quem tem estoque.movimentar. */
export async function movimentarEstoque(v: { productId: string; kind: "entrada" | "saida" | "ajuste"; qty: number; unitCostCents?: number | null; note?: string | null }): Promise<R> {
  try {
    const u = await assertPerm("estoque.movimentar");
    const m = z.object({ productId: z.string().uuid(), kind: z.enum(["entrada", "saida", "ajuste"]), qty: z.number(), unitCostCents: z.number().int().min(0).nullish(), note: z.string().max(300).nullish() }).parse(v);
    await addStockMovement(m, { id: u.id, perms: u.perms }); refreshEstoque(); return { ok: true };
  } catch (e) { return fail(e); }
}

/** Os últimos 20 movimentos de um produto, para a folha do produto. Quem vê a aba Produtos. */
export async function movimentosDoProduto(productId: string): Promise<R<StockMovementRow[]>> {
  try {
    await assertAnyPerm("atendimento.ver", "estoque.produtos", "estoque.movimentar");
    return { ok: true, data: await listStockMovements(z.string().uuid().parse(productId), 20) };
  } catch (e) { return fail(e); }
}

const feeInput = z.object({ method: z.enum(["credito", "debito"]), brand: z.string().max(20), parcelado: z.boolean(), feeBp: z.number().int().nullable() });
/** Aba Formas de pagamento › Taxas do cartão: só quem tem "Mudar as taxas do cartão" (caixa.taxas). Vale só para os pagamentos novos. */
export async function savePaymentFeeAction(v: z.input<typeof feeInput>): Promise<R> {
  try {
    const u = await assertPerm("caixa.taxas");
    await savePaymentFee(feeInput.parse(v), { id: u.id, perms: u.perms });
    revalidatePath("/servicos"); revalidatePath("/caixa", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

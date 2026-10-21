"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveFiscalEmpresa, setFiscalRegras, setNfceModo, setNfseModo } from "@/server/domain/fiscal/config";

type R = { ok: true } | { ok: false; error: string };
const refresh = () => { revalidatePath("/config/nota-fiscal"); revalidatePath("/config", "layout"); revalidatePath("/caixa", "layout"); };
const fail = (e: unknown): R => ({ ok: false, error: userErrorMessage(e, "config-nota-fiscal", "Não deu certo. Tente de novo.") });

const empresa = z.object({
  cnpj: z.string().max(30).nullable(), razaoSocial: z.string().max(200).nullable(), inscricaoMunicipal: z.string().max(40).nullable(), inscricaoEstadual: z.string().max(40).nullable(),
  regime: z.enum(["simples", "presumido"]).nullable(), aliquotaSimplesBp: z.number().int().nullable(), aliquotaIssBp: z.number().int().nullable(), codigoMunicipio: z.literal("2927408"),
  endereco: z.object({ logradouro: z.string().max(200), numero: z.string().max(40), bairro: z.string().max(120), cep: z.string().max(20) }).nullable(),
  cTribNacPadrao: z.string().max(20), nbsPadrao: z.string().max(20).nullable(), serieDps: z.number().int(), serieNfce: z.number().int(), emitirAoFechar: z.boolean(),
});
const regras = z.object({
  rascunhoNaComanda: z.boolean(), tentativasMax: z.number().int(), esperaMaxMin: z.number().int(), certAvisoDias: z.number().int(), nfceCancelarAteMin: z.number().int(),
  assinaturaNfse: z.enum(["sha1", "sha256"]), informarAliquotaNaDps: z.boolean(),
  textos: z.object({ servicos: z.string().max(2000), parceria: z.string().max(2000), cotaParceira: z.string().max(2000) }),
});

/** Configurações › Nota fiscal (nota.configurar). O domínio confere a permissão de novo e audita de/para. */
export async function salvarFiscalEmpresa(v: z.input<typeof empresa>): Promise<R> {
  try { const u = await assertPerm("nota.configurar"); await saveFiscalEmpresa(empresa.parse(v), { id: u.id, perms: u.perms }); refresh(); return { ok: true }; } catch (e) { return fail(e); }
}
export async function mudarNfseModo(m: "desligada" | "teste" | "producao"): Promise<R> {
  try { const u = await assertPerm("nota.configurar"); await setNfseModo(z.enum(["desligada", "teste", "producao"]).parse(m), { id: u.id, perms: u.perms }); refresh(); return { ok: true }; } catch (e) { return fail(e); }
}
/** A chave da NFC-e (nota do produto): a mesma regra da NFS-e para ir à Produção. */
export async function mudarNfceModo(m: "desligada" | "teste" | "producao"): Promise<R> {
  try { const u = await assertPerm("nota.configurar"); await setNfceModo(z.enum(["desligada", "teste", "producao"]).parse(m), { id: u.id, perms: u.perms }); refresh(); return { ok: true }; } catch (e) { return fail(e); }
}
export async function salvarFiscalRegras(v: z.input<typeof regras>): Promise<R> {
  try { const u = await assertPerm("nota.configurar"); await setFiscalRegras(regras.parse(v), { id: u.id, perms: u.perms }); refresh(); return { ok: true }; } catch (e) { return fail(e); }
}

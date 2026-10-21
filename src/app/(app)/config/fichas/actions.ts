"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { isUuid } from "@/lib/uuid";
import { userErrorMessage } from "@/server/user-error";
import { moveQuestion, saveQuestion, setQuestionActive } from "@/server/domain/fichas";
import { savePhotoConfig } from "@/server/domain/client-photos";
import type { FichaForm, QuestionKind } from "@/lib/fichas";

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
// Sem `.uuid()` estrito: as perguntas da Casa nascem na migration com id md5, que não é UUID v4.
const idSchema = z.string().refine(isUuid);
const dirSchema = z.enum(["up", "down"]);
const activeSchema = z.boolean();
const BAD = "Pedido inválido.";
const FAIL = "Não foi possível salvar a pergunta. Tente de novo.";

/** Cria (sem id) ou edita uma pergunta da ficha (texto, tipo e opções). Só quem tem config.fichas. Nada aqui envia mensagem. */
export async function saveQuestionAction(input: { id?: string; form: FichaForm; label: string; kind: QuestionKind; options?: string[] }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await assertPerm("config.fichas");
    if (input.id !== undefined && !idSchema.safeParse(input.id).success) return { ok: false, error: BAD };
    const data = await saveQuestion(input, u.id);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config fichas", FAIL) }; }
}

/** Sobe ou desce a pergunta na ficha. Só quem tem config.fichas. */
export async function moveQuestionAction(id: string, dir: "up" | "down"): Promise<ActionResult> {
  try {
    const u = await assertPerm("config.fichas");
    if (!idSchema.safeParse(id).success || !dirSchema.safeParse(dir).success) return { ok: false, error: BAD };
    await moveQuestion(id, dir, u.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config fichas", "Não foi possível mudar a ordem. Tente de novo.") }; }
}

/** Põe a pergunta em uso ou tira de uso (a resposta antiga continua na ficha). Só quem tem config.fichas. */
export async function setQuestionActiveAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    const u = await assertPerm("config.fichas");
    if (!idSchema.safeParse(id).success || !activeSchema.safeParse(active).success) return { ok: false, error: BAD };
    await setQuestionActive(id, active, u.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config fichas", FAIL) }; }
}

/** Tamanho máximo da foto de antes e depois (MB). Só quem tem config.fichas; o servidor confere de 1 a 20. */
export async function savePhotoConfigAction(input: { maxMb: number }): Promise<ActionResult<{ maxMb: number }>> {
  try {
    const u = await assertPerm("config.fichas");
    if (typeof input?.maxMb !== "number") return { ok: false, error: BAD };
    const data = await savePhotoConfig({ maxMb: input.maxMb }, u.id);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config fichas", "Não foi possível salvar o tamanho. Tente de novo.") }; }
}

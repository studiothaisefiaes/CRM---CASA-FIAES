"use server";
import { revalidatePath } from "next/cache";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { saveLembreteD1 } from "@/server/domain/client-link/reminder";
import { userErrorMessage } from "@/server/user-error";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.sistema"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/automacoes"); return { ok: true, data }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "lembrete-d1") }; }
}

const ligado = (v: unknown) => !!v && typeof v === "object" && (v as { enabled?: unknown }).enabled === true;
/**
 * Lembrete do horário (Lote 7B): textos e desligar. Ligar é pela Virada (Task 10, `/config/virada`); salvar ligado também exige
 * `virada.fazer` no servidor.
 */
export const saveLembreteD1Action = async (v: unknown) => run(async (u) => {
  if (ligado(v)) await assertPerm("virada.fazer");
  return saveLembreteD1(v, u);
});

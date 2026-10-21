"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveSpecialDays } from "@/server/domain/special-days";
import type { SpecialDay } from "@/lib/special-days";

type R = { ok: true; agenda: "sincronizada" | "consulta" } | { ok: false; error: string };
/** Salva os Dias especiais (Configurações › Horário de funcionamento). Exige `horario.dias_especiais` no servidor. */
export async function saveSpecialDaysAction(days: SpecialDay[]): Promise<R> {
  try {
    const u = await assertPerm("horario.dias_especiais");
    const r = await saveSpecialDays(days, u.id);
    revalidatePath("/config/etapas");
    revalidatePath("/agenda");
    return { ok: true, agenda: r.agenda };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "dias_especiais") }; }
}

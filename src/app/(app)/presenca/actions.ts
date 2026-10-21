"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertUser } from "@/server/auth/session";
import { setAvailability } from "@/server/domain/presence";
import { userErrorMessage } from "@/server/user-error";

/** A própria pessoa muda o estado na distribuição (menu do nome). Pausa/ausente devolvem os leads ainda sem resposta. */
export async function setAvailabilityAction(a: string): Promise<{ ok: true; returned: number } | { ok: false; error: string }> {
  try {
    const user = await assertUser();
    const v = z.enum(["disponivel", "pausa", "ausente"]).parse(a);
    const r = await setAvailability(user.id, v);
    revalidatePath("/", "layout");
    return { ok: true, returned: r.returned };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "presenca") }; }
}

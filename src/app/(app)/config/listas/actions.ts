"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { saveServiceDetails } from "@/server/domain/service-details";
import { userErrorMessage } from "@/server/user-error";

const patch = z.object({
  priceCents: z.number().int().nullable().optional(),
  durationMin: z.number().int().nullable().optional(),
  bufferMin: z.number().int().nullable().optional(),
  category: z.string().max(200).nullable().optional(),
});

/** Serviços: preço (centavos), duração e folga depois (min) e categoria. Só o campo que veio muda. Pede "Mudar serviços e preços" (M2, 17/10). */
export async function saveServiceDetailsAction(id: string, v: z.input<typeof patch>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const u = await assertPerm("servicos.editar");
    await saveServiceDetails(z.string().uuid().parse(id), patch.parse(v), u.id);
    revalidatePath("/config/listas");
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "config") }; }
}

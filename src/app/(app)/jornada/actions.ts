"use server";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { getJourneyStation, type JourneyPerson } from "@/server/queries/journey";
import { userErrorMessage } from "@/server/user-error";
import type { ActionResult } from "@/app/(app)/funil/actions";

/** "+N" da estação: todas as pessoas dela, para a estação abrir ali mesmo (antes o toque levava para a Fila e a Jornada sumia). */
export async function journeyStationAction(key: string): Promise<ActionResult<JourneyPerson[]>> {
  try {
    await assertPerm("jornada.ver");
    const k = z.string().regex(/^[a-z0-9_]{1,40}$/).parse(key);
    return { ok: true, data: await getJourneyStation(k) };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "jornada") }; }
}

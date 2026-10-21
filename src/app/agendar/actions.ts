"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { clientIp } from "@/server/auth/client-ip";
import { createOnlineRequest, onlineSlots } from "@/server/domain/client-link/online";
import { userErrorMessage } from "@/server/user-error";

/** Ações públicas do agendamento online (desligado por padrão): horários livres e o pedido, os dois com limite por IP. */
export type OnlineResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function onlineSlotsAction(serviceId: string, professionalId: string | null, d: string): Promise<OnlineResult<string[]>> {
  try { return { ok: true, data: await onlineSlots({ serviceId: z.string().uuid().parse(serviceId), professionalId: z.string().uuid().nullable().parse(professionalId), day: day.parse(d) }, new Date(), clientIp(await headers())) }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "agendar", "Não deu para ver os horários. Tente de novo.") }; }
}

const input = z.object({
  serviceId: z.string().uuid(), professionalId: z.string().uuid().nullable(), day, time: z.string().regex(/^\d{2}:\d{2}$/),
  name: z.string().max(120), phone: z.string().max(30), note: z.string().max(400), honeypot: z.string().max(400), formToken: z.string().max(80),
});
export async function onlineRequestAction(v: z.input<typeof input>): Promise<OnlineResult<{ message: string }>> {
  try { return { ok: true, data: await createOnlineRequest(input.parse(v), { ip: clientIp(await headers()) }) }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "agendar", "Não deu para enviar o pedido. Tente de novo.") }; }
}

"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { clientIp } from "@/server/auth/client-ip";
import { cancelByLink, confirmByLink, requestRescheduleByLink } from "@/server/domain/client-link/respond";
import { userErrorMessage } from "@/server/user-error";

/** Ações públicas do link da cliente: só o token (sem login), com limite por IP e por link. O Next confere a origem do pedido. */
export type LinkResult = { ok: true; message: string } | { ok: false; error: string };
const token = z.string().max(64);
const shown = z.string().max(40);
const ip = async () => clientIp(await headers());
const fail = (e: unknown): LinkResult => ({ ok: false, error: userErrorMessage(e, "link-cliente", "Não deu certo. Atualize a página e tente de novo.") });

export async function confirmLinkAction(t: string, shownStart: string): Promise<LinkResult> {
  try { return { ok: true, ...(await confirmByLink(token.parse(t), shown.parse(shownStart), { ip: await ip() })) }; } catch (e) { return fail(e); }
}
export async function rescheduleLinkAction(t: string, shownStart: string, wish: string): Promise<LinkResult> {
  try { return { ok: true, ...(await requestRescheduleByLink(token.parse(t), shown.parse(shownStart), z.string().max(400).parse(wish), { ip: await ip() })) }; } catch (e) { return fail(e); }
}
export async function cancelLinkAction(t: string, shownStart: string, motivo: string, texto: string): Promise<LinkResult> {
  try { return { ok: true, ...(await cancelByLink(token.parse(t), shown.parse(shownStart), { motivo: z.string().max(30).parse(motivo), texto: z.string().max(400).parse(texto) }, { ip: await ip() })) }; } catch (e) { return fail(e); }
}

"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite, inviteLanding } from "@/server/auth/users";
import { createSession } from "@/server/auth/session";
import { allow } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/client-ip";
import { userErrorMessage } from "@/server/user-error";
import { acceptContadorLink } from "@/server/domain/contador-link";

export type InviteState = { error?: string };
/** O link do contador devolve também o que a pessoa escreveu (nome e e-mail), para não precisar digitar de novo depois de um erro. */
export type ContadorLinkState = InviteState & { values?: { name: string; email: string } };
const TOO_MANY = "Muitas tentativas. Espere alguns minutos e tente de novo.";

export async function acceptInviteAction(token: string, _: InviteState, form: FormData): Promise<InviteState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { error: "As senhas não são iguais." };
  // Mesmo limitador do login: quem chuta tokens de convite esbarra em 10 tentativas por IP a cada 10 minutos.
  if (!allow(`convite:${clientIp(await headers())}`, 10)) return { error: TOO_MANY };
  let target = "/";
  try {
    const user = await acceptInvite(token, password);
    await createSession(user.id);
    target = await inviteLanding(user.id);
  } catch (e) {
    return { error: userErrorMessage(e, "convite", "Não foi possível aceitar o convite.") };
  }
  redirect(target);
}

/**
 * Link do contador (26/10): quem abre põe nome, e-mail e senha e entra com o perfil Contador. Mesmo limite por IP do convite (o mesmo
 * contador: 10 tentativas a cada 10 minutos, somando convite e link); o link é conferido antes do argon2 (acceptContadorLink).
 */
export async function acceptContadorLinkAction(token: string, _: ContadorLinkState, form: FormData): Promise<ContadorLinkState> {
  const name = String(form.get("name") ?? "").slice(0, 200), email = String(form.get("email") ?? "").slice(0, 200);
  const password = String(form.get("password") ?? ""), confirm = String(form.get("confirm") ?? "");
  const values = { name, email };
  if (password !== confirm) return { error: "As senhas não são iguais.", values };
  if (!allow(`convite:${clientIp(await headers())}`, 10)) return { error: TOO_MANY, values };
  let target = "/";
  try {
    const user = await acceptContadorLink(token, { name, email, password });
    await createSession(user.id);
    target = await inviteLanding(user.id);
  } catch (e) {
    return { error: userErrorMessage(e, "link-contador", "Não foi possível criar o acesso."), values };
  }
  redirect(target);
}

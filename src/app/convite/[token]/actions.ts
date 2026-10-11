"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/server/auth/users";
import { createSession } from "@/server/auth/session";
import { allow } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/client-ip";

export type InviteState = { error?: string };

export async function acceptInviteAction(token: string, _: InviteState, form: FormData): Promise<InviteState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { error: "As senhas não são iguais." };
  // Mesmo limitador do login: quem chuta tokens de convite esbarra em 10 tentativas por IP a cada 10 minutos.
  if (!allow(`convite:${clientIp(await headers())}`, 10)) return { error: "Muitas tentativas. Espere alguns minutos e tente de novo." };
  try {
    const user = await acceptInvite(token, password);
    await createSession(user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não foi possível aceitar o convite." };
  }
  redirect("/");
}

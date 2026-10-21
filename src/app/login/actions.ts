"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials } from "@/server/auth/users";
import { createSession, destroySession, getSessionUser } from "@/server/auth/session";
import { setAvailability } from "@/server/domain/presence";
import { allow, resetLimit } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/client-ip";

/** Só aceita voltar para uma página do próprio CRM (bloqueia //, /\\ e URLs externas). */
function safeReturn(voltar?: string) {
  if (!voltar) return "/";
  try {
    const base = new URL("http://crm.local");
    const u = new URL(voltar, base);
    return u.origin === base.origin && voltar.startsWith("/") && !/^\/[\\/]/.test(voltar) ? u.pathname + u.search : "/";
  } catch { return "/"; }
}

export type LoginState = { error?: string; email?: string };

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1), voltar: z.string().optional() });

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  const email = String(form.get("email") ?? "");
  if (!parsed.success) return { error: "Preencha um e-mail válido e a senha.", email };
  const ip = clientIp(await headers());
  const key = `${ip}:${parsed.data.email.toLowerCase()}`;
  if (!allow(`ip:${ip}`, 30) || !allow(key)) return { error: "Muitas tentativas. Espere alguns minutos e tente de novo.", email };
  const user = await checkCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: "E-mail ou senha incorretos.", email };
  resetLimit(key);
  await createSession(user.id);
  redirect(safeReturn(parsed.data.voltar));
}

export async function logout() {
  // Saiu: fica ausente na hora (e devolve os leads sem resposta, se a distribuição estiver ligada). Nunca impede de sair.
  const user = await getSessionUser().catch(() => null);
  if (user) await setAvailability(user.id, "ausente", new Date(), { manual: false }).catch((e) => console.error("[sair] disponibilidade", e));
  await destroySession();
  redirect("/login");
}

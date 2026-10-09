"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials } from "@/server/auth/users";
import { createSession, destroySession } from "@/server/auth/session";
import { allow, resetLimit } from "@/server/auth/rate-limit";

export type LoginState = { error?: string; email?: string };

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1), voltar: z.string().optional() });

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  const email = String(form.get("email") ?? "");
  if (!parsed.success) return { error: "Preencha um e-mail válido e a senha.", email };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${parsed.data.email.toLowerCase()}`;
  if (!allow(key)) return { error: "Muitas tentativas. Espere alguns minutos e tente de novo.", email };
  const user = await checkCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: "E-mail ou senha incorretos.", email };
  resetLimit(key);
  await createSession(user.id);
  const voltar = parsed.data.voltar;
  redirect(voltar && voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

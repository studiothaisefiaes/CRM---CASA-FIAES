"use server";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/server/auth/users";
import { createSession } from "@/server/auth/session";

export type InviteState = { error?: string };

export async function acceptInviteAction(token: string, _: InviteState, form: FormData): Promise<InviteState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { error: "As senhas não são iguais." };
  try {
    const user = await acceptInvite(token, password);
    await createSession(user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não foi possível aceitar o convite." };
  }
  redirect("/");
}

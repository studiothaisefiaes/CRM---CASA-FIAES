import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");
  const sp = await searchParams;
  const voltar = typeof sp.voltar === "string" ? sp.voltar : undefined;
  return (
    <AuthShell title="Entrar" subtitle="Atendimento e vendas da Casa Fiaes">
      <LoginForm voltar={voltar} />
    </AuthShell>
  );
}

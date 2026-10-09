import Link from "next/link";
import { findInvite } from "@/server/auth/users";
import { AuthShell } from "@/components/auth-shell";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const invite = await findInvite(token);
  if (!invite) {
    return (
      <AuthShell title="Convite expirado" subtitle="Este link já foi usado ou passou de 7 dias.">
        <p className="text-graphite">Peça um novo convite à gestão da Casa. <Link href="/login" className="underline">Ir para o login</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Olá, ${invite.name.split(" ")[0]}`} subtitle={`Você foi convidada para o CRM como ${invite.role === "gestor" ? "gestão" : "atendimento"}.`}>
      <InviteForm token={token} />
    </AuthShell>
  );
}

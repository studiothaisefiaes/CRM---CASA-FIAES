import Link from "next/link";
import { eq } from "drizzle-orm";
import { findInvite } from "@/server/auth/users";
import { db } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { AuthShell } from "@/components/auth-shell";
import { InviteForm } from "./invite-form";
import { ContadorLinkForm } from "./contador-form";
import { findContadorLink } from "@/server/domain/contador-link";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const invite = await findInvite(token);
  // Link do contador (26/10): o mesmo endereço público, sem e-mail amarrado; quem abre põe nome, e-mail e senha.
  const contador = invite ? null : await findContadorLink(token);
  if (contador) {
    return (
      <AuthShell title="Acesso do contador" subtitle={`Crie o seu acesso ao CRM da Casa Fiaes com o perfil ${contador.profileName}: você vê os relatórios do dinheiro e as notas fiscais, sem mudar nada. Este link vale uma vez só.`}>
        <ContadorLinkForm token={token} />
      </AuthShell>
    );
  }
  if (!invite) {
    return (
      <AuthShell title="Convite expirado" subtitle="Este link já foi usado ou passou de 7 dias.">
        <p className="text-graphite">Peça um novo convite à gestão da Casa. <Link href="/login" className="underline">Ir para o login</Link></p>
      </AuthShell>
    );
  }
  const [profile] = invite.profileId ? await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, invite.profileId)) : [];
  return (
    <AuthShell title={`Olá, ${invite.name.split(" ")[0]}`} subtitle={profile ? `Você foi convidada para o CRM com o perfil ${profile.name}.` : "Você foi convidada para o CRM."}>
      <InviteForm token={token} />
    </AuthShell>
  );
}

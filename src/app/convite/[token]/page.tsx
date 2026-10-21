import Link from "next/link";
import { eq } from "drizzle-orm";
import { findInvite } from "@/server/auth/users";
import { db } from "@/server/db";
import { profiles } from "@/server/db/schema";
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
  const [profile] = invite.profileId ? await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, invite.profileId)) : [];
  return (
    <AuthShell title={`Olá, ${invite.name.split(" ")[0]}`} subtitle={profile ? `Você foi convidada para o CRM com o perfil ${profile.name}.` : "Você foi convidada para o CRM."}>
      <InviteForm token={token} />
    </AuthShell>
  );
}

import { notFound } from "next/navigation";
import { env } from "@/server/env";
import { requireUser } from "@/server/auth/session";
import { Simulator } from "./simulator";

export const metadata = { title: "Simulador" };

export default async function SimPage() {
  if (!env().DEV_TOOLS) notFound();
  await requireUser();
  return (
    <main className="max-w-[560px] mx-auto px-5 py-10">
      <p className="text-xs font-semibold text-gold-ink">Só em desenvolvimento</p>
      <h1 className="font-serif text-[36px] font-light mt-1">Simulador do WhatsApp</h1>
      <p className="text-graphite mt-2 mb-8">Envia ao CRM o mesmo evento que a Evolution enviaria. Serve para testar o fluxo sem parear um número real.</p>
      <Simulator />
    </main>
  );
}

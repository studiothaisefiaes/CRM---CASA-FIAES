import { requirePerm } from "@/server/auth/session";
import { getAfterVisit } from "@/server/domain/after-visit";
import { AfterVisitSettings } from "@/components/config/after-visit";

export const metadata = { title: "Depois do atendimento" };

export default async function DepoisAtendimentoPage() {
  await requirePerm("config.sistema");
  return <AfterVisitSettings initial={await getAfterVisit()} />;
}

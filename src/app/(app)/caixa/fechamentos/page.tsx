import { redirect } from "next/navigation";
import { requirePerm } from "@/server/auth/session";

export const metadata = { title: "Fechamentos" };

/** O histórico agora mora dentro de "Fechar caixa / dia"; o endereço antigo leva para lá. */
export default async function FechamentosPage() {
  await requirePerm("caixa.operar");
  redirect("/caixa/fechar-dia#historico");
}

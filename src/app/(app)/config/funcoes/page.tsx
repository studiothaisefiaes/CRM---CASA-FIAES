import { requirePerm } from "@/server/auth/session";
import { FUNCOES, resolveFuncao } from "@/lib/funcoes";
import { getFuncoesState } from "@/server/domain/funcoes";
import { FuncoesEditor } from "@/components/config/funcoes";

export const metadata = { title: "Recursos" };

export default async function FuncoesPage() {
  await requirePerm("config.funcoes");
  const state = await getFuncoesState();
  return <FuncoesEditor items={FUNCOES.map((def) => ({ def, value: resolveFuncao(def, state) }))} />;
}

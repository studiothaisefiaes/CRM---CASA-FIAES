import { can } from "@/lib/permissions";
import { requireAnyPerm } from "@/server/auth/session";
import { FUNCOES, resolveFuncao } from "@/lib/funcoes";
import { getFuncoesState } from "@/server/domain/funcoes";
import { LIBRARY_TAGS, listLibrary } from "@/server/domain/library";
import { LibraryEditor } from "@/components/config/library";

export const metadata = { title: "Biblioteca" };

export default async function BibliotecaPage() {
  const user = await requireAnyPerm("biblioteca.gerir", "biblioteca.enviar");
  const fn = resolveFuncao(FUNCOES.find((f) => f.key === "biblioteca")!, await getFuncoesState());
  const items = await listLibrary();
  return <LibraryEditor items={items} suggestedTags={[...LIBRARY_TAGS]} enabled={fn.on} maxMb={fn.params.tamanho_max_mb} canManage={can(user.perms, "biblioteca.gerir")} />;
}

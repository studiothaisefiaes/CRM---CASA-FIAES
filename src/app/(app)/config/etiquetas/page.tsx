import { requirePerm } from "@/server/auth/session";
import { listTagsAdmin } from "@/server/domain/tags";
import { TagsAdmin } from "@/components/config/tags";

export const metadata = { title: "Etiquetas" };

/** Etiquetas das clientes: cor, renomear, juntar e quantas clientes têm cada uma (dia a dia). */
export default async function EtiquetasPage() {
  await requirePerm("config.diaadia");
  return <TagsAdmin tags={await listTagsAdmin()} />;
}

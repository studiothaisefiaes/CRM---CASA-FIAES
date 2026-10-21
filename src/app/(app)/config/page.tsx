import { CONFIG_ENTRY_PERMS } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { requireAnyPerm } from "@/server/auth/session";
import { configGroups, configTabs, defaultConfigGroup, stateOf } from "@/lib/config-tabs";
import { ConfigIndex } from "@/components/config/config-index";
import { configSnapshot } from "@/server/queries/config-index";

export const metadata = { title: "Configurações" };

/** Índice de Configurações (F5): a busca e os grupos, cada item com a frase do que faz e o estado de agora. */
export default async function ConfigIndexPage({ searchParams }: PageProps<"/config">) {
  const user = await requireAnyPerm(...CONFIG_ENTRY_PERMS);
  const fallback = defaultConfigGroup(user.perms);
  if (!fallback) redirect("/");
  const grupo = (await searchParams).grupo;
  const group = configGroups(user.perms).find((g) => g.id === grupo)?.id ?? fallback;
  const snap = await configSnapshot();
  const states = Object.fromEntries(configTabs(user.perms).map((i) => [i.id, stateOf(i, snap)]));
  return <ConfigIndex perms={[...user.perms]} group={group} states={states} />;
}

import { CONFIG_ENTRY_PERMS } from "@/lib/permissions";
import { requireAnyPerm } from "@/server/auth/session";
import { ConfigShell } from "@/components/config/config-shell";
import { configGroups, configTabs, groupHint, type ConfigGroupId, type ConfigState } from "@/lib/config-tabs";
import { configSnapshot } from "@/server/queries/config-index";

export default async function ConfigLayout({ children }: LayoutProps<"/config">) {
  const user = await requireAnyPerm(...CONFIG_ENTRY_PERMS);
  const snap = await configSnapshot();
  const items = configTabs(user.perms);
  const hints = Object.fromEntries(configGroups(user.perms).map((g) => [g.id, groupHint(g, items, snap)])) as Partial<Record<ConfigGroupId, ConfigState>>;
  return <ConfigShell perms={[...user.perms]} hints={hints}>{children}</ConfigShell>;
}

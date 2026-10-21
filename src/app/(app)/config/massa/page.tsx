import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { getMassSettings, listCampaigns } from "@/server/domain/campaigns";
import { MassSettings } from "@/components/config/mass-settings";

export const metadata = { title: "Mensagem em massa" };

export default async function MassaPage() {
  const user = await requirePerm("config.sistema");
  const [s, list] = await Promise.all([getMassSettings(), listCampaigns()]);
  return <MassSettings enabled={s.enabled} campaigns={list} canSend={can(user.perms, "mensagem.massa")} />;
}

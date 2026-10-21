import { requirePerm } from "@/server/auth/session";
import { getCasaInfo, getClientLinkSettings } from "@/server/domain/client-link/settings";
import { ClientPageSettings } from "@/components/config/client-page-settings";

export const metadata = { title: "Página da cliente" };

export default async function PaginaClientePage() {
  await requirePerm("config.sistema");
  const [casa, link] = await Promise.all([getCasaInfo(), getClientLinkSettings()]);
  return <ClientPageSettings casa={casa} link={link} />;
}

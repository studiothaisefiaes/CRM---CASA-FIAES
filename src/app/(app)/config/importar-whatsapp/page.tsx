import { requirePerm } from "@/server/auth/session";
import { WhatsappImport } from "@/components/config/whatsapp-import";

export const metadata = { title: "Trazer conversa antiga do WhatsApp" };

export default async function ImportarWhatsappPage() {
  await requirePerm("config.sistema");
  return <WhatsappImport />;
}

import { requirePerm } from "@/server/auth/session";
import { ChatguruImport } from "@/components/config/chatguru-import";

export const metadata = { title: "Importar conversas antigas" };

export default async function ChatguruPage() {
  await requirePerm("config.sistema");
  return <ChatguruImport />;
}

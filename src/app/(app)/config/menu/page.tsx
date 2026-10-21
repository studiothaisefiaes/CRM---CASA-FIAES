import { requirePerm } from "@/server/auth/session";
import { getWelcomeMenu, welcomeMenuChoices } from "@/server/domain/welcome-menu";
import { WelcomeMenuEditor } from "@/components/config/welcome-menu";

export const metadata = { title: "Menu de boas-vindas" };

export default async function MenuPage() {
  await requirePerm("config.sistema");
  const [initial, choices] = await Promise.all([getWelcomeMenu(), welcomeMenuChoices()]);
  return <WelcomeMenuEditor initial={initial} {...choices} />;
}
